import { useEffect, useMemo, useState } from "react";
import type { CaseStatus } from "../api/caseApi";
import { getCaseLabs, syncCaseHisLab, type CaseLabRow } from "../api/caseHisApi";

type Props = {
  caseStatus: CaseStatus;
};

const card =
  "rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 p-3 space-y-3";
const input =
  "rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1.5 text-xs";
const secondaryButton =
  "rounded border border-gray-300 dark:border-gray-700 px-3 py-1.5 text-xs";

function fmt(ts: number) {
  const d = new Date(ts);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

function isCriticalFlag(raw: string | null | undefined) {
  const flag = String(raw || "").trim().toUpperCase();
  return flag === "HH" || flag === "LL" || flag === "CRITICAL";
}

export default function LabView({ caseStatus }: Props) {
  const activeCase = caseStatus.status === "IDLE" ? null : caseStatus;
  const caseId = activeCase?.case_id ?? null;

  const [labGroup, setLabGroup] = useState("28");
  const [criticalOnly, setCriticalOnly] = useState(true);
  const [labs, setLabs] = useState<CaseLabRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const shownLabs = useMemo(() => {
    const sorted = [...labs].sort((a, b) => Number(b.collected_at || 0) - Number(a.collected_at || 0));
    if (!criticalOnly) return sorted;
    return sorted.filter(row => isCriticalFlag(row.flag));
  }, [criticalOnly, labs]);

  useEffect(() => {
    if (!activeCase || !caseId) {
      setLabs([]);
      setError("");
      setNote("");
      return;
    }
    let alive = true;
    const toTs = Date.now();
    const fromTs = Math.max(
      activeCase.start_time - 24 * 60 * 60 * 1000,
      toTs - 7 * 24 * 60 * 60 * 1000,
    );
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const rows = await getCaseLabs(caseId, { fromTs, toTs, limit: 500 });
        if (!alive) return;
        setLabs(rows);
        setNote(rows.length > 0 ? `Loaded ${rows.length} lab records.` : "");
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "Load lab failed");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [activeCase, caseId]);

  useEffect(() => {
    if (!caseId) return;
    const onHisSynced = (event: Event) => {
      const custom = event as CustomEvent<{ caseId?: unknown }>;
      const changedCaseId = Number(custom.detail?.caseId);
      if (!Number.isFinite(changedCaseId) || changedCaseId !== caseId) return;
      const toTs = Date.now();
      const fromTs = Math.max(toTs - 7 * 24 * 60 * 60 * 1000, toTs - 24 * 60 * 60 * 1000);
      void (async () => {
        try {
          const rows = await getCaseLabs(caseId, { fromTs, toTs, limit: 500 });
          setLabs(rows);
        } catch {
          // Keep current rows if refresh fails.
        }
      })();
    };
    window.addEventListener("aidas:his-synced", onHisSynced);
    return () => window.removeEventListener("aidas:his-synced", onHisSynced);
  }, [caseId]);

  const onGetLab = async () => {
    if (!caseId) {
      setError("Start case first.");
      return;
    }
    const grp = String(labGroup || "28").trim() || "28";
    setLoading(true);
    setError("");
    try {
      const result = await syncCaseHisLab(caseId, grp, { allow_buffer_fallback: true });
      setLabs(result.rows);
      const suffix =
        result.his_errors && Object.keys(result.his_errors).length > 0
          ? ` (partial: ${Object.keys(result.his_errors).join(", ")})`
          : "";
      setNote(`Loaded lab group ${grp} (${(result.source || "HIS").toLowerCase()})${suffix}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Get lab failed");
    } finally {
      setLoading(false);
    }
  };

  if (!activeCase || !caseId) {
    return (
      <div className="app-theme-scope p-4">
        <div className={card}>
          <div className="text-sm font-semibold">Lab</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            No active case. Start case first to load lab by group.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-theme-scope p-4 space-y-3">
      <section className={card}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm font-semibold mr-2">Lab</div>
          <input
            className={`${input} w-20`}
            value={labGroup}
            onChange={e => setLabGroup(e.target.value)}
            list="lab-group-list-labview"
            placeholder="LabGrp"
          />
          <datalist id="lab-group-list-labview">
            <option value="28" />
            <option value="27" />
            <option value="26" />
            <option value="25" />
            <option value="24" />
          </datalist>
          <button
            type="button"
            className={secondaryButton}
            onClick={() => void onGetLab()}
            disabled={loading}
          >
            {loading ? "Loading..." : "Get Lab"}
          </button>
          <label className="inline-flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={criticalOnly}
              onChange={e => setCriticalOnly(e.target.checked)}
            />
            Critical only
          </label>
          {note ? (
            <div className="text-xs text-gray-500 dark:text-gray-400">{note}</div>
          ) : null}
        </div>

        {error ? (
          <div className="text-xs text-red-600 dark:text-red-400">{error}</div>
        ) : null}

        {shownLabs.length === 0 ? (
          <div className="text-xs text-gray-500 dark:text-gray-400">
            No lab data.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-left border-b border-gray-200 dark:border-gray-800">
                  <th className="py-1 pr-2">Collected</th>
                  <th className="py-1 pr-2">Test</th>
                  <th className="py-1 pr-2">Result</th>
                  <th className="py-1 pr-2">Ref</th>
                  <th className="py-1 pr-2">Flag</th>
                  <th className="py-1 pr-2">Group</th>
                </tr>
              </thead>
              <tbody>
                {shownLabs.map(row => (
                  <tr key={row.id} className="border-b border-gray-100 dark:border-gray-900">
                    <td className="py-1 pr-2">{row.collected_at ? fmt(row.collected_at) : "-"}</td>
                    <td className="py-1 pr-2">{row.test_name}</td>
                    <td className="py-1 pr-2">{row.value_text || "-"} {row.unit || ""}</td>
                    <td className="py-1 pr-2">{row.ref_range || "-"}</td>
                    <td className="py-1 pr-2">{row.flag || "-"}</td>
                    <td className="py-1 pr-2">{row.test_group || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

