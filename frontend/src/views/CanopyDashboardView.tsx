import { useCallback, useEffect, useMemo, useState } from "react";
import { getActiveFleetCases, getLeaves, type FleetCase, type LeafNode } from "../api/fleetApi";

const stateTone = {
  online: {
    dot: "bg-emerald-400",
    panel: "border-emerald-500/35 bg-emerald-500/8",
    text: "text-emerald-700 dark:text-emerald-300",
  },
  live: {
    dot: "bg-emerald-400",
    panel: "border-emerald-500/35 bg-emerald-500/8",
    text: "text-emerald-700 dark:text-emerald-300",
  },
  delayed: {
    dot: "bg-amber-400",
    panel: "border-amber-500/40 bg-amber-500/8",
    text: "text-amber-700 dark:text-amber-300",
  },
  offline: {
    dot: "bg-rose-500",
    panel: "border-rose-500/40 bg-rose-500/8",
    text: "text-rose-700 dark:text-rose-300",
  },
} as const;

function elapsed(value: string | null | undefined) {
  if (!value) return "No heartbeat";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "Unknown";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

function dateTime(value: string | number | null | undefined) {
  if (value == null) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function MetricCard({ label, value, detail, tone = "neutral" }: {
  label: string;
  value: number;
  detail: string;
  tone?: "neutral" | "good" | "warning" | "danger";
}) {
  const styles = tone === "good"
    ? "border-emerald-500/35 bg-emerald-500/8"
    : tone === "warning"
      ? "border-amber-500/40 bg-amber-500/8"
      : tone === "danger"
        ? "border-rose-500/40 bg-rose-500/8"
        : "border-[var(--app-border)] bg-[var(--app-panel-bg)]";
  return (
    <article className={`rounded-2xl border p-4 ${styles}`}>
      <div className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-[var(--app-muted)]">{label}</div>
      <div className="mt-1 text-3xl font-bold text-[var(--app-text)]">{value}</div>
      <div className="mt-1 text-xs text-[var(--app-muted)]">{detail}</div>
    </article>
  );
}

export default function CanopyDashboardView() {
  const [leaves, setLeaves] = useState<LeafNode[]>([]);
  const [cases, setCases] = useState<FleetCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [nextLeaves, nextCases] = await Promise.all([getLeaves(), getActiveFleetCases()]);
      setLeaves(nextLeaves);
      setCases(nextCases);
      setUpdatedAt(new Date());
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Canopy control room is unavailable.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(true), 10_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const caseCountByLeaf = useMemo(() => {
    const counts = new Map<string, number>();
    cases.forEach(entry => counts.set(entry.leaf_id, (counts.get(entry.leaf_id) || 0) + 1));
    return counts;
  }, [cases]);
  const online = leaves.filter(leaf => leaf.connection_status === "online").length;
  const delayed = leaves.filter(leaf => leaf.connection_status === "delayed").length;
  const offline = leaves.filter(leaf => leaf.connection_status === "offline").length;
  const unhealthyFeeds = cases.filter(entry => entry.sync_status !== "live").length;
  const configIssues = leaves.filter(leaf => leaf.config_status !== "synced").length;
  const attention = delayed + offline + unhealthyFeeds + configIssues;
  const orderedLeaves = useMemo(() => [...leaves].sort((left, right) => {
    const rank = { offline: 0, delayed: 1, online: 2 } as const;
    return rank[left.connection_status] - rank[right.connection_status]
      || left.display_name.localeCompare(right.display_name);
  }), [leaves]);
  const locationGroups = useMemo(() => {
    const groups = new Map<string, { hospital: string; building: string; careUnit: string; leaves: LeafNode[] }>();
    orderedLeaves.forEach(leaf => {
      const hospital = leaf.hospital_name || leaf.hospital_id || "Unassigned hospital";
      const building = leaf.building_name || "Unassigned building";
      const careUnit = leaf.care_unit_name || "Unassigned care unit";
      const key = `${hospital}\u0000${building}\u0000${careUnit}`;
      const group = groups.get(key) || { hospital, building, careUnit, leaves: [] };
      group.leaves.push(leaf);
      groups.set(key, group);
    });
    return Array.from(groups.values());
  }, [orderedLeaves]);

  return (
    <main className="h-full overflow-y-auto bg-[var(--app-bg)] p-3 sm:p-5">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-[var(--app-accent)]">Flora Canopy · control room</div>
            <h1 className="mt-1 text-2xl font-semibold text-[var(--app-text)]">Leaf operations dashboard</h1>
            <p className="mt-1 text-sm text-[var(--app-muted)]">Hospital-wide visibility of Leaf connectivity, synchronization, and active clinical work.</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-[var(--app-muted)]">{updatedAt ? `Updated ${updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "Waiting for status"}</span>
            <button type="button" onClick={() => void refresh()} disabled={loading} className="rounded-xl border border-[var(--app-border)] bg-[var(--app-control-bg)] px-4 py-2.5 text-sm font-semibold text-[var(--app-text)] disabled:opacity-50">{loading ? "Refreshing…" : "Refresh"}</button>
          </div>
        </header>

        {error ? <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-600 dark:text-rose-300">{error}</div> : null}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="Canopy operational summary">
          <MetricCard label="Leaf stations" value={leaves.length} detail="Registered workstations" />
          <MetricCard label="Online" value={online} detail="Heartbeat within 90 seconds" tone="good" />
          <MetricCard label="Delayed / offline" value={delayed + offline} detail={`${delayed} delayed · ${offline} offline`} tone={delayed + offline ? "danger" : "good"} />
          <MetricCard label="Active cases" value={cases.length} detail="Currently synchronized" tone="good" />
          <MetricCard label="Needs attention" value={attention} detail={`${configIssues} config · ${delayed + offline + unhealthyFeeds} connection`} tone={attention ? "warning" : "good"} />
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div><h2 className="text-lg font-semibold text-[var(--app-text)]">Leaf stations</h2><p className="text-xs text-[var(--app-muted)]">Problems are shown first so the team can respond quickly.</p></div>
            <div className="flex items-center gap-3 text-xs text-[var(--app-muted)]"><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-400" />Online</span><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-400" />Delayed</span><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-rose-500" />Offline</span></div>
          </div>
          <div className="space-y-3">
            {locationGroups.map(group => <section key={`${group.hospital}/${group.building}/${group.careUnit}`} className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-bg)] p-3"><div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1"><div><div className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-[var(--app-accent)]">{group.hospital} · {group.building}</div><h3 className="mt-0.5 font-semibold text-[var(--app-text)]">{group.careUnit}</h3></div><span className="text-xs font-semibold text-[var(--app-muted)]">{group.leaves.length} Leaf{group.leaves.length === 1 ? "" : "s"}</span></div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{group.leaves.map(leaf => {
                const tone = stateTone[leaf.connection_status];
                return <article key={leaf.leaf_id} className={`rounded-xl border p-4 ${tone.panel}`}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h4 className="truncate font-semibold text-[var(--app-text)]">{leaf.display_name}</h4><div className="mt-0.5 truncate text-xs text-[var(--app-muted)]">{leaf.room_name || "Room —"} · {leaf.bed_name || "Bed —"}</div></div><span className={`inline-flex items-center gap-2 rounded-full border border-current/20 px-2.5 py-1 text-xs font-bold capitalize ${tone.text}`}><span className={`h-2 w-2 rounded-full ${tone.dot}`} />{leaf.connection_status}</span></div><div className="mt-4 grid grid-cols-3 gap-2 border-t border-[var(--app-border)] pt-3 text-xs"><div><div className="text-[var(--app-muted)]">Heartbeat</div><div className="mt-1 font-semibold text-[var(--app-text)]">{elapsed(leaf.last_seen_at)}</div></div><div><div className="text-[var(--app-muted)]">Active cases</div><div className="mt-1 font-semibold text-[var(--app-text)]">{caseCountByLeaf.get(leaf.leaf_id) || 0}</div></div><div><div className="text-[var(--app-muted)]">Config</div><div className="mt-1 truncate font-semibold capitalize text-[var(--app-text)]">{leaf.config_status || "unassigned"}</div></div></div></article>;
              })}</div></section>)}
            {!loading && orderedLeaves.length === 0 ? <div className="rounded-2xl border border-dashed border-[var(--app-border)] px-6 py-12 text-center text-sm text-[var(--app-muted)] md:col-span-2 xl:col-span-3">No Leaf workstations are registered.</div> : null}
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-bg)]">
          <div className="flex items-center justify-between border-b border-[var(--app-border)] px-4 py-3"><div><h2 className="font-semibold text-[var(--app-text)]">Active clinical work</h2><p className="text-xs text-[var(--app-muted)]">Operational context only; open Clinical charts for the full read-only record.</p></div><span className="rounded-full bg-emerald-500/12 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-300">{cases.length} live</span></div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-[var(--app-muted)]"><tr><th className="px-4 py-3">Patient / case</th><th className="px-4 py-3">Leaf</th><th className="px-4 py-3">Started</th><th className="px-4 py-3">Last sync</th><th className="px-4 py-3">Feed</th></tr></thead>
              <tbody>
                {cases.map(entry => <tr key={entry.global_case_id} className="border-t border-[var(--app-border)] text-[var(--app-text)]"><td className="px-4 py-3"><div className="font-semibold">HN {entry.hn || "—"}</div><div className="text-xs text-[var(--app-muted)]">{entry.case_code || entry.source_case_id}</div></td><td className="px-4 py-3">{entry.leaf_name}</td><td className="px-4 py-3 text-xs">{dateTime(entry.start_time)}</td><td className="px-4 py-3 text-xs">{elapsed(entry.last_synced_at)}</td><td className="px-4 py-3"><span className={`inline-flex items-center gap-2 text-xs font-bold capitalize ${stateTone[entry.sync_status].text}`}><span className={`h-2 w-2 rounded-full ${stateTone[entry.sync_status].dot}`} />{entry.sync_status}</span></td></tr>)}
                {!loading && cases.length === 0 ? <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-[var(--app-muted)]">No active synchronized cases.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
