import { useEffect, useMemo, useState } from "react";
import type { CaseStatus } from "../api/caseApi";
import {
  createCaseDiagnosis,
  createCaseProcedure,
  deleteCaseDiagnosis,
  deleteCaseProcedure,
  getCaseDiagnosis,
  getCaseProcedures,
  searchIcd10,
  type CaseDiagnosisRow,
  type CaseProcedureRow,
  type Icd10Match,
} from "../api/caseClinicalApi";

type Props = {
  caseStatus: CaseStatus;
};

const card =
  "rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 p-3 space-y-3";

function pickIcdText(match: Icd10Match): string {
  return (match.name_en || match.name_th || "").trim();
}

function IcdSuggestionList({
  rows,
  onPick,
}: {
  rows: Icd10Match[];
  onPick: (row: Icd10Match) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="rounded border border-gray-200 dark:border-gray-800 max-h-44 overflow-y-auto">
      {rows.map((row) => {
        const text = pickIcdText(row);
        return (
          <button
            key={`${row.icd10}-${row.icd10who}-${text}`}
            type="button"
            onClick={() => onPick(row)}
            className="w-full text-left px-2 py-1.5 border-b border-gray-100 dark:border-gray-900 last:border-b-0 hover:bg-gray-50 dark:hover:bg-gray-900"
          >
            <div className="text-xs font-medium">
              {row.icd10} {text ? `| ${text}` : ""}
            </div>
            {row.name_th ? (
              <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                {row.name_th}
              </div>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export default function DiagnosisView({ caseStatus }: Props) {
  const caseId = caseStatus.status === "IDLE" ? null : caseStatus.case_id;
  const [diagnosisRows, setDiagnosisRows] = useState<CaseDiagnosisRow[]>([]);
  const [operationRows, setOperationRows] = useState<CaseProcedureRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const [diagEntryText, setDiagEntryText] = useState("");
  const [diagIcd10Text, setDiagIcd10Text] = useState("");
  const [diagIcd10Code, setDiagIcd10Code] = useState("");
  const [diagMatches, setDiagMatches] = useState<Icd10Match[]>([]);

  const [operationEntryText, setOperationEntryText] = useState("");
  const [operationIcd9Text, setOperationIcd9Text] = useState("");
  const [operationIcd9Code, setOperationIcd9Code] = useState("");

  const canSaveDiagnosis = useMemo(() => diagEntryText.trim().length > 0, [diagEntryText]);
  const canSaveOperation = useMemo(
    () => operationEntryText.trim().length > 0,
    [operationEntryText],
  );

  useEffect(() => {
    if (caseId == null) {
      setDiagnosisRows([]);
      setOperationRows([]);
      setError("");
      return;
    }
    const activeCaseId = caseId;

    let alive = true;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const [diagnosis, operations] = await Promise.all([
          getCaseDiagnosis(activeCaseId),
          getCaseProcedures(activeCaseId),
        ]);
        if (!alive) return;
        setDiagnosisRows(diagnosis);
        setOperationRows(operations);
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "Failed to load clinical data");
      } finally {
        if (alive) setLoading(false);
      }
    }

    void load();
    return () => {
      alive = false;
    };
  }, [caseId]);

  useEffect(() => {
    const keyword = diagEntryText.trim();
    if (keyword.length < 2) {
      setDiagMatches([]);
      return;
    }

    let alive = true;
    const timer = window.setTimeout(async () => {
      try {
        const rows = await searchIcd10(keyword, 12);
        if (!alive) return;
        setDiagMatches(rows);
      } catch {
        if (!alive) return;
        setDiagMatches([]);
      }
    }, 250);

    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [diagEntryText]);

  const addDiagnosis = async () => {
    if (!caseId || !canSaveDiagnosis) return;
    setSaving(true);
    setError("");
    try {
      const row = await createCaseDiagnosis(caseId, {
        diagnosis_text: diagEntryText.trim(),
        icd_text: diagIcd10Text.trim() || undefined,
        icd_code: diagIcd10Code.trim() || undefined,
        icd_version: diagIcd10Code.trim() ? "ICD-10" : undefined,
        seq: diagnosisRows.length + 1,
      });
      setDiagnosisRows((prev) => [...prev, row]);
      setDiagEntryText("");
      setDiagIcd10Text("");
      setDiagIcd10Code("");
      setDiagMatches([]);
      window.dispatchEvent(
        new CustomEvent("aidas:clinical-changed", { detail: { caseId } }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save diagnosis");
    } finally {
      setSaving(false);
    }
  };

  const addOperation = async () => {
    if (!caseId || !canSaveOperation) return;
    setSaving(true);
    setError("");
    try {
      const row = await createCaseProcedure(caseId, {
        procedure_text: operationEntryText.trim(),
        icd_text: operationIcd9Text.trim() || undefined,
        icd_code: operationIcd9Code.trim() || undefined,
        icd_version: operationIcd9Code.trim() ? "ICD-9" : undefined,
        seq: operationRows.length + 1,
      });
      setOperationRows((prev) => [...prev, row]);
      setOperationEntryText("");
      setOperationIcd9Text("");
      setOperationIcd9Code("");
      window.dispatchEvent(
        new CustomEvent("aidas:clinical-changed", { detail: { caseId } }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save operation");
    } finally {
      setSaving(false);
    }
  };

  const removeDiagnosis = async (id: number) => {
    if (!caseId) return;
    try {
      await deleteCaseDiagnosis(caseId, id);
      setDiagnosisRows((prev) => prev.filter((row) => row.id !== id));
      window.dispatchEvent(
        new CustomEvent("aidas:clinical-changed", { detail: { caseId } }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove diagnosis");
    }
  };

  const removeOperation = async (id: number) => {
    if (!caseId) return;
    try {
      await deleteCaseProcedure(caseId, id);
      setOperationRows((prev) => prev.filter((row) => row.id !== id));
      window.dispatchEvent(
        new CustomEvent("aidas:clinical-changed", { detail: { caseId } }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove operation");
    }
  };

  if (caseStatus.status === "IDLE") {
    return <div className="p-6 text-gray-400">No active case</div>;
  }

  return (
    <div className="p-4 pb-24 space-y-4 text-gray-900 dark:text-gray-100">
      <section className={card}>
        <div className="text-sm font-semibold">Diagnosis (Important OR Data)</div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
          <input
            value={diagEntryText}
            onChange={(e) => setDiagEntryText(e.target.value)}
            className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1.5 text-sm"
            placeholder="diag_entry_text"
          />
          <input
            value={diagIcd10Text}
            onChange={(e) => setDiagIcd10Text(e.target.value)}
            className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1.5 text-sm"
            placeholder="diag_icd10_text"
          />
          <div className="flex gap-2">
            <input
              value={diagIcd10Code}
              onChange={(e) => setDiagIcd10Code(e.target.value)}
              className="flex-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1.5 text-sm"
              placeholder="diag_icd10_code"
            />
            <button
              type="button"
              onClick={() => void addDiagnosis()}
              disabled={!canSaveDiagnosis || saving}
              className={`rounded px-3 py-1.5 text-sm text-white ${
                !canSaveDiagnosis || saving
                  ? "bg-gray-400 cursor-not-allowed"
                  : "bg-blue-600 hover:bg-blue-700"
              }`}
            >
              Add
            </button>
          </div>
        </div>
        <IcdSuggestionList
          rows={diagMatches}
          onPick={(row) => {
            setDiagIcd10Code(row.icd10);
            setDiagIcd10Text(pickIcdText(row));
          }}
        />

        {loading ? (
          <div className="text-xs text-gray-500 dark:text-gray-400">Loading...</div>
        ) : diagnosisRows.length === 0 ? (
          <div className="text-xs text-gray-500 dark:text-gray-400">
            No diagnosis records yet.
          </div>
        ) : (
          <div className="rounded border border-gray-200 dark:border-gray-800 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-100 dark:bg-gray-900/50">
                <tr>
                  <th className="px-2 py-1 text-left">Entry</th>
                  <th className="px-2 py-1 text-left">ICD10 Text</th>
                  <th className="px-2 py-1 text-left">ICD10 Code</th>
                  <th className="px-2 py-1 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {diagnosisRows.map((row) => (
                  <tr key={row.id} className="border-t border-gray-200 dark:border-gray-800">
                    <td className="px-2 py-1">{row.diagnosis_text}</td>
                    <td className="px-2 py-1">{row.icd_text || "-"}</td>
                    <td className="px-2 py-1">{row.icd_code || "-"}</td>
                    <td className="px-2 py-1 text-right">
                      <button
                        type="button"
                        onClick={() => void removeDiagnosis(row.id)}
                        className="text-red-500 hover:text-red-600"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={card}>
        <div className="text-sm font-semibold">Operation (Important OR Data)</div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
          <input
            value={operationEntryText}
            onChange={(e) => setOperationEntryText(e.target.value)}
            className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1.5 text-sm"
            placeholder="operation_entry_text"
          />
          <input
            value={operationIcd9Text}
            onChange={(e) => setOperationIcd9Text(e.target.value)}
            className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1.5 text-sm"
            placeholder="operation_icd9_text (optional)"
          />
          <div className="flex gap-2">
            <input
              value={operationIcd9Code}
              onChange={(e) => setOperationIcd9Code(e.target.value)}
              className="flex-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1.5 text-sm"
              placeholder="operation_icd9_code (optional)"
            />
            <button
              type="button"
              onClick={() => void addOperation()}
              disabled={!canSaveOperation || saving}
              className={`rounded px-3 py-1.5 text-sm text-white ${
                !canSaveOperation || saving
                  ? "bg-gray-400 cursor-not-allowed"
                  : "bg-blue-600 hover:bg-blue-700"
              }`}
            >
              Add
            </button>
          </div>
        </div>
        {operationRows.length === 0 ? (
          <div className="text-xs text-gray-500 dark:text-gray-400">
            No operation records yet.
          </div>
        ) : (
          <div className="rounded border border-gray-200 dark:border-gray-800 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-100 dark:bg-gray-900/50">
                <tr>
                  <th className="px-2 py-1 text-left">Entry</th>
                  <th className="px-2 py-1 text-left">ICD9 Text</th>
                  <th className="px-2 py-1 text-left">ICD9 Code</th>
                  <th className="px-2 py-1 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {operationRows.map((row) => (
                  <tr key={row.id} className="border-t border-gray-200 dark:border-gray-800">
                    <td className="px-2 py-1">{row.procedure_text}</td>
                    <td className="px-2 py-1">{row.icd_text || "-"}</td>
                    <td className="px-2 py-1">{row.icd_code || "-"}</td>
                    <td className="px-2 py-1 text-right">
                      <button
                        type="button"
                        onClick={() => void removeOperation(row.id)}
                        className="text-red-500 hover:text-red-600"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {error ? (
        <div className="text-xs text-red-600 dark:text-red-400">{error}</div>
      ) : null}
    </div>
  );
}
