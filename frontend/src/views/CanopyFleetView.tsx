import { useCallback, useEffect, useState } from "react";
import { getActiveFleetCases, getFleetCaseSnapshot, getLeaves, type FleetCase, type LeafNode } from "../api/fleetApi";

const tone: Record<string, string> = {
  online: "bg-emerald-400",
  live: "bg-emerald-400",
  delayed: "bg-amber-400",
  offline: "bg-rose-400",
};

function elapsed(iso: string) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

export default function CanopyFleetView() {
  const [leaves, setLeaves] = useState<LeafNode[]>([]);
  const [cases, setCases] = useState<FleetCase[]>([]);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<{ entry: FleetCase; snapshot: Record<string, unknown> } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [nextLeaves, nextCases] = await Promise.all([getLeaves(), getActiveFleetCases()]);
      setLeaves(nextLeaves);
      setCases(nextCases);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Fleet unavailable");
    }
  }, []);

  const openCase = useCallback(async (entry: FleetCase) => {
    try {
      const result = await getFleetCaseSnapshot(entry.global_case_id);
      setSelected({ entry, snapshot: result.snapshot });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Case snapshot unavailable");
    }
  }, []);

  const sectionRows = (key: string) => {
    const section = selected?.snapshot[key] as { rows?: unknown[] } | undefined;
    return Array.isArray(section?.rows) ? section.rows : [];
  };

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-5 p-4 md:p-6">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--app-muted)]">Flora Canopy</div>
          <h1 className="mt-1 text-2xl font-semibold text-[var(--app-text)]">Hospital live overview</h1>
        </div>
        <button className="rounded-lg border border-[var(--app-border)] bg-[var(--app-control-bg)] px-4 py-2 text-sm" onClick={() => void refresh()}>
          Refresh
        </button>
      </section>

      {error ? <div className="rounded-xl border border-rose-400/40 bg-rose-400/10 p-3 text-rose-200">{error}</div> : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {leaves.map((leaf) => (
          <article key={leaf.leaf_id} className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-bg)] p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-semibold text-[var(--app-text)]">{leaf.display_name}</div>
                <div className="truncate text-xs text-[var(--app-muted)]">{leaf.hospital_id} · {leaf.leaf_id}</div>
              </div>
              <div className="flex items-center gap-2 text-xs font-semibold capitalize text-[var(--app-muted)]">
                <span className={`h-2.5 w-2.5 rounded-full ${tone[leaf.connection_status]}`} />
                {leaf.connection_status}
              </div>
            </div>
            <div className="mt-3 text-xs text-[var(--app-muted)]">Updated {elapsed(leaf.last_seen_at)}</div>
          </article>
        ))}
        {!leaves.length && !error ? <div className="text-sm text-[var(--app-muted)]">No Leaf workstations connected.</div> : null}
      </section>

      <section className="overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-bg)]">
        <div className="border-b border-[var(--app-border)] px-4 py-3">
          <h2 className="font-semibold text-[var(--app-text)]">Active cases <span className="text-[var(--app-accent)]">{cases.length}</span></h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-[var(--app-muted)]">
              <tr><th className="px-4 py-3">Patient HN</th><th className="px-4 py-3">Case</th><th className="px-4 py-3">Leaf</th><th className="px-4 py-3">Started</th><th className="px-4 py-3">Feed</th></tr>
            </thead>
            <tbody>
              {cases.map((entry) => (
                <tr key={entry.global_case_id} onClick={() => void openCase(entry)} className="cursor-pointer border-t border-[var(--app-border)] text-[var(--app-text)] hover:bg-[var(--app-control-bg)]">
                  <td className="px-4 py-3 font-semibold">{entry.hn || "—"}</td>
                  <td className="px-4 py-3">{entry.case_code || entry.source_case_id}</td>
                  <td className="px-4 py-3">{entry.leaf_name}</td>
                  <td className="px-4 py-3">{entry.start_time ? new Date(entry.start_time).toLocaleString() : "—"}</td>
                  <td className="px-4 py-3"><span className="inline-flex items-center gap-2 capitalize"><span className={`h-2.5 w-2.5 rounded-full ${tone[entry.sync_status]}`} />{entry.sync_status}</span></td>
                </tr>
              ))}
              {!cases.length ? <tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--app-muted)]">No synchronized active cases.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      {selected ? (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/60 p-3" role="dialog" aria-modal="true">
          <section className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-bg)] shadow-2xl">
            <header className="sticky top-0 flex items-center justify-between gap-3 border-b border-[var(--app-border)] bg-[var(--app-panel-bg)] px-5 py-4">
              <div><div className="text-xs uppercase tracking-wider text-[var(--app-muted)]">{selected.entry.leaf_name} · live read-only</div><h2 className="text-xl font-semibold">HN {selected.entry.hn || "—"} · {selected.entry.case_code || selected.entry.source_case_id}</h2></div>
              <button className="rounded-lg border border-[var(--app-border)] px-3 py-2" onClick={() => setSelected(null)}>Close</button>
            </header>
            <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
              {(["allergies", "diagnosis", "procedures", "staff"] as const).map((key) => (
                <article key={key} className="rounded-xl border border-[var(--app-border)] bg-[var(--app-control-bg)] p-4">
                  <div className="text-xs font-semibold uppercase tracking-wider text-[var(--app-muted)]">{key}</div>
                  <div className="mt-2 text-2xl font-semibold">{sectionRows(key).length}</div>
                  <div className="text-xs text-[var(--app-muted)]">recorded entries</div>
                </article>
              ))}
            </div>
            <div className="grid gap-3 px-5 pb-5 sm:grid-cols-3">
              <div className="rounded-xl border border-[var(--app-border)] p-4"><div className="text-xs uppercase text-[var(--app-muted)]">Vitals</div><div className="mt-1 text-xl font-semibold">{sectionRows("vitals").length} minutes</div></div>
              <div className="rounded-xl border border-[var(--app-border)] p-4"><div className="text-xs uppercase text-[var(--app-muted)]">Events</div><div className="mt-1 text-xl font-semibold">{sectionRows("events").length} entries</div></div>
              <div className="rounded-xl border border-[var(--app-border)] p-4"><div className="text-xs uppercase text-[var(--app-muted)]">I/O</div><div className="mt-1 text-xl font-semibold">{sectionRows("io_events").length} entries</div></div>
            </div>
            <div className="px-5 pb-5 text-sm text-[var(--app-muted)]">The synchronized chart payload is available. Full Kronos chart rendering is the next viewer increment.</div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
