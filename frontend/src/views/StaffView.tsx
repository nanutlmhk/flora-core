import { useEffect, useMemo, useState } from "react";
import type { CaseStatus } from "../api/caseApi";
import type { AuthUser } from "../auth/useAuth";
import {
  createStaffDirectoryEntry,
  deactivateStaffDirectoryEntry,
  getCaseStaff,
  getStaffDirectory,
  getStaffRoles,
  saveCaseStaff,
  updateStaffDirectoryEntry,
  type StaffLibraryItem,
  type StaffMember,
  type StaffRole,
} from "../api/staffApi";

type Props = {
  caseStatus: CaseStatus;
  sessionUser: AuthUser | null;
  defaultTab?: StaffTab;
};
type StaffTab = "current" | "master";

const card =
  "rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 p-3 space-y-3";

const FALLBACK_ROLES: StaffRole[] = [
  { id: "anesthetist", name: "Anesthetist", sort_order: 1 },
  { id: "assistant", name: "Assistant", sort_order: 2 },
  { id: "circulatingNurse", name: "Circulating nurse", sort_order: 3 },
  { id: "fellowAnesthetist", name: "Fellow Anesthetist", sort_order: 4 },
  { id: "instrumentNurse", name: "Instrument nurse", sort_order: 5 },
  { id: "medicalStudent", name: "Medical Student", sort_order: 6 },
  { id: "nurseAnesthetist", name: "Nurse anesthetist", sort_order: 7 },
  { id: "rotateResident", name: "Rotate resident", sort_order: 8 },
  { id: "scrubNurse", name: "Scrub nurse", sort_order: 9 },
  { id: "surgeon", name: "Surgeon", sort_order: 10 },
  { id: "surgeryResident", name: "Surgery resident", sort_order: 11 },
  { id: "anesthetistResident", name: "Anesthetist Resident", sort_order: 12 },
];

function fmt(ts: number) {
  if (!Number.isFinite(ts) || ts <= 0) return "-";
  const d = new Date(ts);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yy} ${hh}:${min}`;
}

function defaultStaff(roleId: string): StaffMember {
  return {
    hospital_id: "",
    personal_id: "",
    email: "",
    th_first_name: "",
    th_last_name: "",
    en_first_name: "",
    en_last_name: "",
    innovian_id: "",
    role_id: roleId,
    entry_year: null,
    name: "",
    role: "",
  };
}

function fillDisplayName(row: StaffMember): string {
  const explicit = String(row.name || "").trim();
  if (explicit) return explicit;
  const en = [row.en_first_name, row.en_last_name]
    .map(v => String(v || "").trim())
    .filter(Boolean)
    .join(" ");
  if (en) return en;
  return [row.th_first_name, row.th_last_name]
    .map(v => String(v || "").trim())
    .filter(Boolean)
    .join(" ");
}

function normalizeCaseStaff(
  staff: StaffMember[],
  roleNameById: Map<string, string>,
  roleIdByName: Map<string, string>,
): StaffMember[] {
  const seen = new Set<string>();
  const rows: StaffMember[] = [];

  for (const item of staff) {
    const roleId =
      String(item.role_id || "").trim() ||
      roleIdByName.get(String(item.role || "").trim().toLowerCase()) ||
      "";
    const role = String(item.role || roleNameById.get(roleId) || "").trim();
    const name = fillDisplayName(item);
    const hospitalId = String(item.hospital_id || "").trim();
    if (!name || !role || !roleId) continue;

    const key = `${name.toLowerCase()}::${roleId.toLowerCase()}::${hospitalId.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    rows.push({
      ...item,
      hospital_id: hospitalId,
      role_id: roleId,
      role,
      name,
    });
  }

  return rows;
}

function toTooltip(row: StaffMember): string {
  const parts: string[] = [];
  if (row.th_first_name || row.th_last_name) {
    parts.push(
      `TH: ${[row.th_first_name, row.th_last_name].filter(Boolean).join(" ")}`,
    );
  }
  if (row.en_first_name || row.en_last_name) {
    parts.push(
      `EN: ${[row.en_first_name, row.en_last_name].filter(Boolean).join(" ")}`,
    );
  }
  if (row.hospital_id) parts.push(`Hospital ID: ${row.hospital_id}`);
  if (row.personal_id) parts.push(`Personal ID: ${row.personal_id}`);
  if (row.email) parts.push(`Email: ${row.email}`);
  if (row.entry_year) parts.push(`Entry Year: ${row.entry_year}`);
  return parts.join("\n");
}

export default function StaffView({ caseStatus, sessionUser, defaultTab = "current" }: Props) {
  const caseId = caseStatus.status === "IDLE" ? null : caseStatus.case_id;
  const [tab] = useState<StaffTab>(defaultTab);

  const [roles, setRoles] = useState<StaffRole[]>(FALLBACK_ROLES);
  const [directory, setDirectory] = useState<StaffLibraryItem[]>([]);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directorySaving, setDirectorySaving] = useState(false);
  const [directoryError, setDirectoryError] = useState("");

  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [savedStaff, setSavedStaff] = useState<StaffMember[]>([]);
  const [caseLoading, setCaseLoading] = useState(false);
  const [caseSaving, setCaseSaving] = useState(false);
  const [caseError, setCaseError] = useState("");

  const [search, setSearch] = useState("");
  const [roleFilterId, setRoleFilterId] = useState("ALL");
  const [includeInactive, setIncludeInactive] = useState(false);

  const [editingDirectoryId, setEditingDirectoryId] = useState<number | null>(null);
  const [form, setForm] = useState<StaffMember>(() =>
    defaultStaff(FALLBACK_ROLES[0].id),
  );
  const [quickName, setQuickName] = useState("");
  const [quickHospitalId, setQuickHospitalId] = useState("");
  const [quickRoleId, setQuickRoleId] = useState(FALLBACK_ROLES[0].id);
  const [note, setNote] = useState("");

  const actor = useMemo(
    () => ({
      username: sessionUser?.username || "unknown",
      name: sessionUser?.name || undefined,
      role: sessionUser?.role || undefined,
    }),
    [sessionUser],
  );

  const roleNameById = useMemo(
    () => new Map(roles.map(row => [row.id, row.name])),
    [roles],
  );
  const roleIdByName = useMemo(
    () => new Map(roles.map(row => [row.name.toLowerCase(), row.id])),
    [roles],
  );
  const sortedRoles = useMemo(
    () => [...roles].sort((a, b) => a.name.localeCompare(b.name)),
    [roles],
  );

  const activeRoleId = sortedRoles[0]?.id || FALLBACK_ROLES[0].id;

  const isCaseDirty = useMemo(
    () =>
      JSON.stringify(normalizeCaseStaff(staff, roleNameById, roleIdByName)) !==
      JSON.stringify(normalizeCaseStaff(savedStaff, roleNameById, roleIdByName)),
    [roleIdByName, roleNameById, savedStaff, staff],
  );

  const loadRoles = async () => {
    try {
      const rows = await getStaffRoles();
      if (rows.length > 0) {
        setRoles(rows);
        setQuickRoleId(prev => prev || rows[0].id);
        setForm(prev => ({
          ...prev,
          role_id: prev.role_id || rows[0].id,
        }));
      }
    } catch {
      setRoles(FALLBACK_ROLES);
    }
  };

  const loadDirectory = async () => {
    setDirectoryLoading(true);
    setDirectoryError("");
    try {
      const rows = await getStaffDirectory({
        limit: 300,
        q: search.trim() || undefined,
        role_id: roleFilterId === "ALL" ? undefined : roleFilterId,
        include_inactive: includeInactive,
      });
      setDirectory(rows);
    } catch (err) {
      setDirectoryError(
        err instanceof Error ? err.message : "Failed to load staff directory",
      );
    } finally {
      setDirectoryLoading(false);
    }
  };

  useEffect(() => {
    void loadRoles();
  }, []);

  useEffect(() => {
    void loadDirectory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, roleFilterId, includeInactive]);

  useEffect(() => {
    if (caseId == null) {
      setStaff([]);
      setSavedStaff([]);
      setCaseError("");
      return;
    }
    const activeCaseId = caseId;

    let alive = true;
    async function loadCaseStaff() {
      setCaseLoading(true);
      setCaseError("");
      try {
        const rows = await getCaseStaff(activeCaseId);
        if (!alive) return;
        setStaff(rows);
        setSavedStaff(rows);
      } catch (err) {
        if (!alive) return;
        setCaseError(err instanceof Error ? err.message : "Failed to load case staff");
      } finally {
        if (alive) setCaseLoading(false);
      }
    }

    void loadCaseStaff();
    return () => {
      alive = false;
    };
  }, [caseId]);

  useEffect(() => {
    if (!roleNameById.has(quickRoleId)) {
      setQuickRoleId(activeRoleId);
    }
    setForm(prev => {
      if (prev.role_id && roleNameById.has(prev.role_id)) return prev;
      return { ...prev, role_id: activeRoleId };
    });
  }, [activeRoleId, quickRoleId, roleNameById]);

  const clearForm = () => {
    setEditingDirectoryId(null);
    setForm(defaultStaff(activeRoleId));
  };

  const pickDirectoryRow = (row: StaffLibraryItem) => {
    setEditingDirectoryId(row.id || null);
    setForm({
      ...row,
      role_id: row.role_id || activeRoleId,
    });
    setQuickName(fillDisplayName(row));
    setQuickHospitalId(row.hospital_id || "");
    setQuickRoleId(row.role_id || activeRoleId);
    setNote("Directory row selected");
  };

  const directoryPayloadFromForm = (): StaffMember => {
    const roleId = String(form.role_id || activeRoleId).trim();
    const role = roleNameById.get(roleId) || "";
    return {
      ...form,
      role_id: roleId,
      role,
      name: fillDisplayName(form),
      entry_year: form.entry_year || null,
    };
  };

  const saveDirectory = async () => {
    setDirectorySaving(true);
    setDirectoryError("");
    setNote("");
    try {
      const payload = directoryPayloadFromForm();
      if (!payload.name || !payload.role_id) {
        throw new Error("Name and role are required");
      }

      if (editingDirectoryId != null) {
        await updateStaffDirectoryEntry(editingDirectoryId, payload, actor);
        setNote("Directory updated");
      } else {
        await createStaffDirectoryEntry(payload, actor);
        setNote("Directory entry created");
      }

      await loadDirectory();
      clearForm();
    } catch (err) {
      setDirectoryError(
        err instanceof Error ? err.message : "Failed to save directory",
      );
    } finally {
      setDirectorySaving(false);
    }
  };

  const deactivateDirectory = async () => {
    if (editingDirectoryId == null) return;
    setDirectorySaving(true);
    setDirectoryError("");
    try {
      await deactivateStaffDirectoryEntry(editingDirectoryId);
      setNote("Directory entry deactivated");
      await loadDirectory();
      clearForm();
    } catch (err) {
      setDirectoryError(
        err instanceof Error ? err.message : "Failed to deactivate directory entry",
      );
    } finally {
      setDirectorySaving(false);
    }
  };

  const addToCurrentCase = (candidate: StaffMember) => {
    if (caseId == null) return;

    const row: StaffMember = {
      ...candidate,
      name: fillDisplayName(candidate),
      role_id: String(candidate.role_id || "").trim(),
      role:
        candidate.role ||
        roleNameById.get(String(candidate.role_id || "").trim()) ||
        "",
      hospital_id: String(candidate.hospital_id || "").trim(),
    };
    if (!row.name || !row.role_id || !row.role) return;

    const key = `${row.name.toLowerCase()}::${row.role_id.toLowerCase()}::${(row.hospital_id || "").toLowerCase()}`;
    const exists = staff.some(item => {
      const name = fillDisplayName(item);
      const roleId = String(item.role_id || "").trim();
      const hospitalId = String(item.hospital_id || "").trim();
      return `${name.toLowerCase()}::${roleId.toLowerCase()}::${hospitalId.toLowerCase()}` === key;
    });
    if (exists) return;

    setStaff(prev => [...prev, row]);
    setNote("Added to current case draft");
  };

  const addQuickToCase = () => {
    const roleId = String(quickRoleId || activeRoleId).trim();
    addToCurrentCase({
      hospital_id: quickHospitalId.trim(),
      name: quickName.trim(),
      role_id: roleId,
      role: roleNameById.get(roleId) || "",
      entry_year: null,
    });
    setQuickName("");
    setQuickHospitalId("");
  };

  const removeCaseStaff = (index: number) => {
    setStaff(prev => prev.filter((_, i) => i !== index));
  };

  const resetCaseDraft = () => {
    setStaff(savedStaff);
    setNote("Case staff draft reset");
  };

  const saveCase = async () => {
    if (caseId == null) return;
    setCaseSaving(true);
    setCaseError("");
    setNote("");
    try {
      const normalized = normalizeCaseStaff(staff, roleNameById, roleIdByName);
      const saved = await saveCaseStaff(caseId, normalized, actor);
      setStaff(saved);
      setSavedStaff(saved);
      setNote(`Saved ${saved.length} case staff`);
      window.dispatchEvent(
        new CustomEvent("aidas:case-staff-changed", {
          detail: { caseId },
        }),
      );
      await loadDirectory();
    } catch (err) {
      setCaseError(err instanceof Error ? err.message : "Failed to save case staff");
    } finally {
      setCaseSaving(false);
    }
  };

  const caseHeaderText =
    caseStatus.status === "IDLE"
      ? "No active case (Directory mode)"
      : `Case #${caseStatus.case_id} | HN ${caseStatus.hn}`;

  return (
    <div className="p-4 pb-24 space-y-4 text-gray-900 dark:text-gray-100">
      <section className={card}>
        <div className="space-y-1">
          <div className="text-sm font-semibold">Staff</div>
          <div className="text-gray-500 dark:text-gray-400">{caseHeaderText}</div>
        </div>
      </section>


      {tab === "current" ? (
        <section className={card}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded border border-gray-200 dark:border-gray-800 p-2 space-y-2">
              <div className="text-sm font-semibold">Staff Directory</div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1.5 text-sm"
                  placeholder="Search name / id / email"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
                <select
                  className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1.5 text-sm"
                  value={roleFilterId}
                  onChange={e => setRoleFilterId(e.target.value)}
                >
                  <option value="ALL">All Roles</option>
                  {sortedRoles.map(role => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-2 rounded border border-gray-300 dark:border-gray-700 px-2 py-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={includeInactive}
                    onChange={e => setIncludeInactive(e.target.checked)}
                  />
                  Include inactive
                </label>
              </div>

              <div className="max-h-[70vh] overflow-y-auto space-y-1">
                {directoryLoading ? (
                  <div className="text-xs text-gray-500 dark:text-gray-400">Loading...</div>
                ) : directory.length === 0 ? (
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    No directory rows.
                  </div>
                ) : (
                  directory.map(item => (
                    <div
                      key={`${item.id}-${item.name}-${item.role_id}`}
                      className="app-tooltip rounded border border-gray-200 dark:border-gray-800 px-2 py-1.5"
                      data-tooltip={toTooltip(item)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => pickDirectoryRow(item)}
                          className="min-w-0 text-left hover:underline"
                        >
                          <div className="truncate">
                            {fillDisplayName(item)}
                            {item.hospital_id ? (
                              <span className="text-xs text-gray-500 dark:text-gray-400">
                                {" "}
                                ({item.hospital_id})
                              </span>
                            ) : null}
                          </div>
                          <div className="truncate text-xs text-gray-500 dark:text-gray-400">
                            {item.role}
                            {item.entry_year ? ` | Entry ${item.entry_year}` : ""}
                            {item.is_active === 0 ? " | Inactive" : ""}
                          </div>
                        </button>
                        {caseId != null ? (
                          <button
                            type="button"
                            onClick={() => addToCurrentCase(item)}
                            className="text-[11px] rounded border border-blue-500 text-blue-600 dark:text-blue-300 px-1.5 py-0.5 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                          >
                            Add
                          </button>
                        ) : null}
                      </div>
                      <div className="text-[10px] text-gray-500 dark:text-gray-400">
                        used {item.used_count} | last {fmt(item.last_used_at)}
                      </div>
                    </div>
                  ))
                )}
              </div>
              {directoryError ? (
                <div className="text-xs text-red-600 dark:text-red-400">{directoryError}</div>
              ) : null}
            </div>

            <div className="rounded border border-gray-200 dark:border-gray-800 p-2 space-y-2">
              <div className="text-sm font-semibold">Current Case Staff</div>
              {caseId == null ? (
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  No active case. Start case to assign staff.
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <input
                      className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1.5 text-sm"
                      placeholder="Hospital ID"
                      value={quickHospitalId}
                      onChange={e => setQuickHospitalId(e.target.value)}
                    />
                    <input
                      className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1.5 text-sm"
                      placeholder="Name"
                      value={quickName}
                      onChange={e => setQuickName(e.target.value)}
                    />
                    <select
                      className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1.5 text-sm"
                      value={quickRoleId}
                      onChange={e => setQuickRoleId(e.target.value)}
                    >
                      {sortedRoles.map(role => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    type="button"
                    onClick={addQuickToCase}
                    disabled={!quickName.trim()}
                    className={`rounded px-3 py-1.5 text-sm text-white ${
                      !quickName.trim()
                        ? "bg-gray-400 cursor-not-allowed"
                        : "bg-blue-600 hover:bg-blue-700"
                    }`}
                  >
                    Add Quick To Case
                  </button>

                  {caseLoading ? (
                    <div className="text-sm text-gray-500 dark:text-gray-400">Loading...</div>
                  ) : staff.length === 0 ? (
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      No staff in this case yet.
                    </div>
                  ) : (
                    <div className="space-y-1 max-h-[56vh] overflow-y-auto">
                      {staff.map((row, index) => (
                        <div
                          key={`${fillDisplayName(row)}-${row.role_id || row.role}-${row.hospital_id || "-"}-${index}`}
                          className="app-tooltip flex items-center justify-between gap-2 rounded border border-gray-200 dark:border-gray-800 px-2 py-1.5"
                          data-tooltip={toTooltip(row)}
                        >
                          <div className="min-w-0">
                            <div className="truncate">
                              {fillDisplayName(row)}
                              {row.hospital_id ? (
                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                  {" "}
                                  ({row.hospital_id})
                                </span>
                              ) : null}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                              {row.role}
                              {row.entry_year ? ` | Entry ${row.entry_year}` : ""}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeCaseStaff(index)}
                            className="text-xs text-red-500 hover:text-red-600"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {caseError ? (
                    <div className="text-xs text-red-600 dark:text-red-400">{caseError}</div>
                  ) : null}

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void saveCase()}
                      disabled={!isCaseDirty || caseSaving}
                      className={`rounded px-3 py-1.5 text-sm text-white ${
                        !isCaseDirty || caseSaving
                          ? "bg-gray-400 cursor-not-allowed"
                          : "bg-blue-600 hover:bg-blue-700"
                      }`}
                    >
                      {caseSaving ? "Saving..." : "Save Case Staff"}
                    </button>
                    <button
                      type="button"
                      onClick={resetCaseDraft}
                      disabled={!isCaseDirty || caseSaving}
                      className={`rounded px-3 py-1.5 text-sm ${
                        !isCaseDirty || caseSaving
                          ? "border border-gray-300 dark:border-gray-700 text-gray-400 cursor-not-allowed"
                          : "border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                      }`}
                    >
                      Reset Draft
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
          {note ? <div className="text-xs text-gray-500 dark:text-gray-400">{note}</div> : null}
        </section>
      ) : (
        <section className={`${card} lg:min-h-[calc(100vh-13rem)] lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)] lg:gap-4 lg:space-y-0`}>
          <div className="rounded border border-gray-200 dark:border-gray-800 p-2 space-y-2 min-h-0">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">Staff Directory</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {directory.length} row{directory.length === 1 ? "" : "s"}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input
                className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1.5 text-sm"
                placeholder="Search name / id / email"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              <select
                className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1.5 text-sm"
                value={roleFilterId}
                onChange={e => setRoleFilterId(e.target.value)}
              >
                <option value="ALL">All Roles</option>
                {sortedRoles.map(role => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 rounded border border-gray-300 dark:border-gray-700 px-2 py-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={includeInactive}
                  onChange={e => setIncludeInactive(e.target.checked)}
                />
                Include inactive
              </label>
            </div>

            <div className="lg:h-[calc(100vh-21rem)] overflow-y-auto space-y-1 pr-1">
              {directoryLoading ? (
                <div className="text-xs text-gray-500 dark:text-gray-400">Loading...</div>
              ) : directory.length === 0 ? (
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  No directory rows.
                </div>
              ) : (
                directory.map(item => {
                  const isSelected = editingDirectoryId != null && item.id === editingDirectoryId;
                  return (
                    <div
                      key={`${item.id}-${item.name}-${item.role_id}`}
                      className={`app-tooltip rounded border px-2 py-2 transition-colors ${
                        isSelected
                          ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-400"
                          : "border-gray-200 dark:border-gray-800"
                      }`}
                      data-tooltip={toTooltip(item)}
                    >
                      <button
                        type="button"
                        onClick={() => pickDirectoryRow(item)}
                        className="w-full min-w-0 text-left"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate font-medium">
                              {fillDisplayName(item)}
                              {item.hospital_id ? (
                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                  {" "}
                                  ({item.hospital_id})
                                </span>
                              ) : null}
                            </div>
                            <div className="truncate text-xs text-gray-500 dark:text-gray-400">
                              {item.role}
                              {item.entry_year ? ` | Entry ${item.entry_year}` : ""}
                              {item.is_active === 0 ? " | Inactive" : ""}
                            </div>
                          </div>
                          {isSelected ? (
                            <span className="shrink-0 rounded border border-blue-500 px-1.5 py-0.5 text-[10px] text-blue-600 dark:text-blue-300">
                              Editing
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 text-[10px] text-gray-500 dark:text-gray-400">
                          used {item.used_count} | last {fmt(item.last_used_at)}
                        </div>
                      </button>
                    </div>
                  );
                })
              )}
            </div>
            {directoryError ? (
              <div className="text-xs text-red-600 dark:text-red-400">{directoryError}</div>
            ) : null}
          </div>

          <div className="rounded border border-gray-200 dark:border-gray-800 p-3 space-y-3 min-h-0 lg:h-[calc(100vh-21rem)] overflow-y-auto">
            <div className="space-y-1">
              <div className="text-sm font-semibold">
                {editingDirectoryId == null ? "Create Staff Entry" : `Edit Entry #${editingDirectoryId}`}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                Select a directory row to edit it, or clear the form to create a new one.
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1.5 text-sm"
                placeholder="Hospital ID"
                value={form.hospital_id || ""}
                onChange={e => setForm(prev => ({ ...prev, hospital_id: e.target.value }))}
              />
              <input
                className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1.5 text-sm"
                placeholder="Entry Year"
                value={form.entry_year || ""}
                onChange={e =>
                  setForm(prev => ({
                    ...prev,
                    entry_year: e.target.value ? Number(e.target.value) : null,
                  }))
                }
              />
              <input
                className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1.5 text-sm"
                placeholder="TH First Name"
                value={form.th_first_name || ""}
                onChange={e => setForm(prev => ({ ...prev, th_first_name: e.target.value }))}
              />
              <input
                className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1.5 text-sm"
                placeholder="TH Last Name"
                value={form.th_last_name || ""}
                onChange={e => setForm(prev => ({ ...prev, th_last_name: e.target.value }))}
              />
              <input
                className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1.5 text-sm"
                placeholder="EN First Name"
                value={form.en_first_name || ""}
                onChange={e => setForm(prev => ({ ...prev, en_first_name: e.target.value }))}
              />
              <input
                className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1.5 text-sm"
                placeholder="EN Last Name"
                value={form.en_last_name || ""}
                onChange={e => setForm(prev => ({ ...prev, en_last_name: e.target.value }))}
              />
              <input
                className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1.5 text-sm"
                placeholder="Display Name"
                value={form.name || ""}
                onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
              />
              <select
                className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1.5 text-sm"
                value={form.role_id || activeRoleId}
                onChange={e => setForm(prev => ({ ...prev, role_id: e.target.value }))}
              >
                {sortedRoles.map(role => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
              <input
                className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1.5 text-sm"
                placeholder="Email"
                value={form.email || ""}
                onChange={e => setForm(prev => ({ ...prev, email: e.target.value }))}
              />
              <input
                className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1.5 text-sm"
                placeholder="Personal ID"
                value={form.personal_id || ""}
                onChange={e => setForm(prev => ({ ...prev, personal_id: e.target.value }))}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void saveDirectory()}
                disabled={directorySaving}
                className={`rounded px-3 py-1.5 text-sm text-white ${
                  directorySaving
                    ? "bg-gray-400 cursor-not-allowed"
                    : "bg-blue-600 hover:bg-blue-700"
                }`}
              >
                {directorySaving ? "Saving..." : "Save Directory"}
              </button>
              <button
                type="button"
                onClick={clearForm}
                className="rounded border border-gray-300 dark:border-gray-700 px-3 py-1.5 text-sm"
              >
                Clear
              </button>
              {editingDirectoryId != null ? (
                <button
                  type="button"
                  onClick={() => void deactivateDirectory()}
                  disabled={directorySaving}
                  className="rounded border border-red-400 text-red-600 dark:text-red-300 px-3 py-1.5 text-sm"
                >
                  Deactivate
                </button>
              ) : null}
            </div>

            {directoryError ? (
              <div className="text-xs text-red-600 dark:text-red-400">{directoryError}</div>
            ) : null}
            {note ? <div className="text-xs text-gray-500 dark:text-gray-400">{note}</div> : null}
          </div>
        </section>
      )}
    </div>
  );
}
