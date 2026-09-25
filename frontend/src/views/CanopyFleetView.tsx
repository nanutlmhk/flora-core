import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getActiveFleetCases,
  getFleetCases,
  getFleetCaseSnapshot,
  getLeaves,
  type FleetCase,
  type LeafNode,
} from "../api/fleetApi";
import CanopyCaseChartView from "./CanopyCaseChartView";

type SelectedCase = {
  entry: FleetCase;
  snapshot: Awaited<ReturnType<typeof getFleetCaseSnapshot>>;
};

type CanopySection = "live" | "archive" | "legacy";

const sectionCopy: Record<CanopySection, { title: string; description: string; empty: string }> = {
  live: {
    title: "Live cases",
    description: "Active synchronized cases from Flora Leaf workstations.",
    empty: "No active cases are being synchronized.",
  },
  archive: {
    title: "Flora archive",
    description: "Completed Flora cases retained for central read-only review.",
    empty: "No completed Flora cases are available.",
  },
  legacy: {
    title: "Innovian archive",
    description: "Historical cases imported specifically from Innovian.",
    empty: "No Innovian cases have been imported yet.",
  },
};

function dateTime(value: string | number | null | undefined) {
  if (value == null) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(undefined, {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(date);
}

function freshness(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

const statusTone: Record<string, string> = {
  ACTIVE: "border-emerald-500/45 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  DISCHARGED: "border-amber-500/45 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  ARCHIVED: "border-[var(--app-border)] bg-[var(--app-control-bg)] text-[var(--app-muted)]",
};

export default function CanopyFleetView() {
  const [section, setSection] = useState<CanopySection>("live");
  const [cases, setCases] = useState<FleetCase[]>([]);
  const [leaves, setLeaves] = useState<LeafNode[]>([]);
  const [selected, setSelected] = useState<SelectedCase | null>(null);
  const [loading, setLoading] = useState(true);
  const [openingId, setOpeningId] = useState("");
  const [error, setError] = useState("");
  const selectedRef = useRef<SelectedCase | null>(null);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  const openCase = useCallback(async (entry: FleetCase, quiet = false) => {
    if (!quiet) setOpeningId(entry.global_case_id);
    try {
      const snapshot = await getFleetCaseSnapshot(entry.global_case_id);
      setSelected({ entry, snapshot });
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The synchronized chart could not be opened.");
    } finally {
      setOpeningId("");
    }
  }, []);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [active, recent, leafRows] = await Promise.all([
        getActiveFleetCases(), getFleetCases(100), getLeaves(),
      ]);
      const merged = new Map<string, FleetCase>();
      [...active, ...recent].forEach(item => merged.set(item.global_case_id, item));
      const next = Array.from(merged.values()).sort((left, right) => {
        const activeRank = Number(right.status === "ACTIVE") - Number(left.status === "ACTIVE");
        return activeRank || new Date(right.last_synced_at).getTime() - new Date(left.last_synced_at).getTime();
      });
      setCases(next);
      setLeaves(leafRows);
      setError("");
      const currentSelection = selectedRef.current;
      if (currentSelection) {
        const current = next.find(item => item.global_case_id === currentSelection.entry.global_case_id);
        if (current) setSelected({ entry: current, snapshot: await getFleetCaseSnapshot(current.global_case_id) });
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Canopy data could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [openCase]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 10_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const leafMap = useMemo(() => new Map(leaves.map(leaf => [leaf.leaf_id, leaf])), [leaves]);
  const isInnovian = useCallback((entry: FleetCase) => {
    const source = `${entry.admission_source || ""} ${entry.source_system || ""}`.toLowerCase();
    return source.includes("innovian");
  }, []);
  const sectionCases = useMemo(() => cases.filter(entry => {
    if (section === "live") return entry.status === "ACTIVE";
    if (section === "legacy") return entry.status !== "ACTIVE" && isInnovian(entry);
    return entry.status !== "ACTIVE" && !isInnovian(entry);
  }), [cases, isInnovian, section]);
  const counts = useMemo(() => ({
    live: cases.filter(entry => entry.status === "ACTIVE").length,
    archive: cases.filter(entry => entry.status !== "ACTIVE" && !isInnovian(entry)).length,
    legacy: cases.filter(entry => entry.status !== "ACTIVE" && isInnovian(entry)).length,
  }), [cases, isInnovian]);
  const changeSection = (next: CanopySection) => {
    setSection(next);
    setSelected(null);
  };
  const canopyNavigation = (
    <nav className="shrink-0 border-b border-[var(--app-border)] bg-[var(--app-panel-bg)] px-3 py-2 sm:px-5" aria-label="Canopy records">
      <div className="mx-auto flex max-w-7xl items-center gap-2">
        {(["live", "archive", "legacy"] as const).map(item => (
          <button
            key={item}
            type="button"
            onClick={() => changeSection(item)}
            aria-current={section === item ? "page" : undefined}
            className={`inline-flex min-h-10 items-center gap-2 rounded-xl border px-4 py-2 text-sm font-bold transition ${section === item ? "border-[var(--app-accent)] bg-[var(--app-accent)] text-[var(--app-accent-contrast)]" : "border-transparent text-[var(--app-muted)] hover:border-[var(--app-border)] hover:bg-[var(--app-control-bg)] hover:text-[var(--app-text)]"}`}
          >
            <span className={`h-2 w-2 rounded-full ${item === "live" ? "bg-emerald-400" : item === "archive" ? "bg-sky-400" : "bg-amber-400"}`} aria-hidden="true" />
            {item === "live" ? "Live" : item === "archive" ? "Archive" : "Legacy"}
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${section === item ? "bg-black/15" : "bg-[var(--app-control-bg)]"}`}>{counts[item]}</span>
          </button>
        ))}
        <span className="ml-auto hidden text-[10px] font-extrabold uppercase tracking-[0.14em] text-[var(--app-muted)] sm:block">Canopy · read-only</span>
      </div>
    </nav>
  );

  if (selected) {
    return <div className="flex h-full min-h-0 flex-col">{canopyNavigation}<div className="min-h-0 flex-1"><CanopyCaseChartView entry={selected.entry} data={selected.snapshot} onBack={() => setSelected(null)} onRefresh={() => void load()} refreshing={loading} /></div></div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--app-bg)]">
      {canopyNavigation}
      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
      <div className="mx-auto max-w-7xl space-y-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div><div className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--app-accent)]">{section === "legacy" ? "Historical Innovian records" : "Synchronized Flora records"}</div><h1 className="mt-1 text-2xl font-semibold text-[var(--app-text)]">{sectionCopy[section].title}</h1><p className="mt-1 text-sm text-[var(--app-muted)]">{sectionCopy[section].description}</p></div>
          <button type="button" onClick={() => void load()} disabled={loading} className="rounded-xl border border-[var(--app-border)] bg-[var(--app-control-bg)] px-4 py-2.5 text-sm font-semibold text-[var(--app-text)] disabled:opacity-50">{loading ? "Refreshing…" : "Refresh"}</button>
        </header>

        {error ? <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-600 dark:text-rose-300">{error}</div> : null}

        <section className="overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-bg)]">
          <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(180px,.8fr)_140px_150px_96px] gap-3 border-b border-[var(--app-border)] px-4 py-3 text-[10px] font-extrabold uppercase tracking-[0.12em] text-[var(--app-muted)] max-lg:hidden"><span>Patient / case</span><span>{section === "legacy" ? "Source system" : "Leaf"}</span><span>Started</span><span>Last sync</span><span /></div>
          {sectionCases.map(entry => {
            const leaf = leafMap.get(entry.leaf_id);
            return (
              <article key={entry.global_case_id} className="grid grid-cols-1 gap-3 border-b border-[var(--app-border)] px-4 py-4 last:border-b-0 lg:grid-cols-[minmax(0,1.5fr)_minmax(180px,.8fr)_140px_150px_96px] lg:items-center">
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong className="truncate text-sm text-[var(--app-text)]">HN {entry.hn || "—"}</strong><span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusTone[entry.status] || statusTone.ARCHIVED}`}>{entry.status}</span></div><div className="mt-1 truncate text-xs text-[var(--app-muted)]">{entry.case_code || entry.source_case_id}</div></div>
                <div><div className="text-sm font-semibold text-[var(--app-text)]">{section === "legacy" ? entry.source_system || "Innovian" : entry.leaf_name || leaf?.display_name || entry.leaf_id}</div><div className="text-xs text-[var(--app-muted)]">{section === "legacy" ? entry.admission_source || "imported" : leaf?.connection_status || entry.sync_status}</div></div>
                <div className="text-xs text-[var(--app-muted)]">{dateTime(entry.start_time)}</div>
                <div className="text-xs text-[var(--app-muted)]"><span className="font-semibold text-[var(--app-text)]">{entry.sync_status}</span><br />{freshness(entry.last_synced_at)}</div>
                <button type="button" onClick={() => void openCase(entry)} disabled={openingId === entry.global_case_id} className="rounded-lg border border-[var(--app-accent)] bg-[var(--app-accent)] px-3 py-2 text-xs font-bold text-[var(--app-accent-contrast)] disabled:opacity-50">{openingId === entry.global_case_id ? "Opening…" : "Open chart"}</button>
              </article>
            );
          })}
          {!loading && sectionCases.length === 0 ? <div className="px-6 py-16 text-center"><div className="text-lg font-semibold text-[var(--app-text)]">{sectionCopy[section].empty}</div><div className="mt-1 text-sm text-[var(--app-muted)]">Select another Canopy section or refresh after new records arrive.</div></div> : null}
        </section>
      </div>
      </div>
    </div>
  );
}
