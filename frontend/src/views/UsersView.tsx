import { useEffect, useMemo, useState } from "react";
import {
  changeOwnPassword,
  createManagedUser,
  getAuthRoles,
  getManagedUsers,
  getSelfManagedUser,
  linkManagedUserStaff,
  resetManagedUserPassword,
  setManagedUserActive,
  updateManagedUserAccess,
  type AuthRole,
  type ManagedAuthUser,
} from "../api/authApi";
import { getStaffDirectory, getStaffMyCases, type StaffLibraryItem, type StaffMyCaseRow } from "../api/staffApi";
import type { AuthUser } from "../auth/useAuth";

type Props = {
  sessionUser: AuthUser | null;
};

function formatDateTime(ts: number | null) {
  if (!Number.isFinite(ts || 0) || !ts) return "-";
  const d = new Date(ts);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yy} ${hh}:${min}`;
}

function sourceLabel(source?: string) {
  const token = String(source || "").trim().toLowerCase();
  if (!token) return "-";
  if (token === "staff") return "Staff";
  if (token === "seed") return "Built-in";
  if (token === "local") return "Local";
  return token;
}

export default function UsersView({ sessionUser }: Props) {
  const isAdmin = sessionUser?.permissions?.includes("account.manage") === true || String(sessionUser?.role || "").trim().toLowerCase() === "admin";
  const [rows, setRows] = useState<ManagedAuthUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [includeInactive, setIncludeInactive] = useState(true);
  const [customPassword, setCustomPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [myCases, setMyCases] = useState<StaffMyCaseRow[]>([]);
  const [myCasesLoading, setMyCasesLoading] = useState(false);
  const [staffDirectory, setStaffDirectory] = useState<StaffLibraryItem[]>([]);
  const [roles, setRoles] = useState<AuthRole[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [accessRoles, setAccessRoles] = useState<string[]>([]);
  const [newUser, setNewUser] = useState({ username: "", name: "", password: "", hospitalId: "", staffDirectoryId: "", roleCodes: ["clinician"] });

  const selected = useMemo(
    () => rows.find(row => row.id === selectedUserId) || rows[0] || null,
    [rows, selectedUserId],
  );

  useEffect(() => {
    if (!selected && rows.length > 0) setSelectedUserId(rows[0].id);
  }, [rows, selected]);

  const loadUsers = async () => {
    setLoading(true);
    setError("");
    try {
      const next = isAdmin
        ? await getManagedUsers({
            q: search.trim() || undefined,
            includeInactive,
          })
        : [await getSelfManagedUser(String(sessionUser?.username || "").trim())];
      setRows(next);
      setSelectedUserId(prev =>
        next.some(row => row.id === prev) ? (prev ?? null) : next[0]?.id ?? null,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, search, includeInactive, sessionUser?.username]);

  useEffect(() => {
    if (!isAdmin) return;
    getStaffDirectory({ include_inactive: true, limit: 500 }).then(setStaffDirectory).catch(() => setStaffDirectory([]));
    getAuthRoles().then(setRoles).catch(() => setRoles([]));
  }, [isAdmin]);

  useEffect(() => {
    setAccessRoles(selected?.roleCodes?.length ? selected.roleCodes : selected?.role ? [selected.role === "admin" ? "system_admin" : selected.role] : []);
  }, [selected?.id, selected?.role, selected?.roleCodes]);

  // For non-admin: load cases where this user appears as a staff member
  useEffect(() => {
    if (isAdmin) return;
    const hospitalId = String(selected?.hospitalId || "").trim();
    const staffDirectoryId = selected?.staffDirectoryId ?? undefined;
    if (!staffDirectoryId && !hospitalId) return;
    setMyCasesLoading(true);
    getStaffMyCases({ staffDirectoryId, hospitalId: staffDirectoryId ? undefined : hospitalId })
      .then(setMyCases)
      .catch(() => setMyCases([]))
      .finally(() => setMyCasesLoading(false));
  }, [isAdmin, selected?.hospitalId, selected?.staffDirectoryId]);

  const replaceRow = (next: ManagedAuthUser) => {
    setRows(prev => prev.map(row => (row.id === next.id ? next : row)));
    setSelectedUserId(next.id);
  };

  const handleToggleActive = async () => {
    if (!selected) return;
    setSaving(true);
    setError("");
    setNote("");
    try {
      const next = await setManagedUserActive(selected.id, !selected.isActive);
      replaceRow(next);
      setNote(`${next.username} is now ${next.isActive ? "active" : "inactive"}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update user");
    } finally {
      setSaving(false);
    }
  };

  const handleStaffLink = async (staffDirectoryId: number | null) => {
    if (!selected) return;
    setSaving(true); setError(""); setNote("");
    try {
      const next = await linkManagedUserStaff(selected.id, staffDirectoryId);
      replaceRow(next);
      setNote(staffDirectoryId ? "Staff profile linked." : "Staff profile unlinked.");
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to link staff profile"); }
    finally { setSaving(false); }
  };

  const handleResetPassword = async (mode: "default" | "custom") => {
    if (!selected) return;
    setSaving(true);
    setError("");
    setNote("");
    try {
      const payload = mode === "custom" ? customPassword.trim() : undefined;
      const result = await resetManagedUserPassword(selected.id, payload);
      replaceRow(result.row);
      setCustomPassword("");
      setNote(`Password reset for ${result.row.username}. Applied password: ${result.appliedPassword}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset password");
    } finally {
      setSaving(false);
    }
  };

  const handleChangeOwnPassword = async () => {
    if (!selected || !sessionUser?.username) return;
    if (newPassword.trim().length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }
    setSaving(true);
    setError("");
    setNote("");
    try {
      const next = await changeOwnPassword(sessionUser.username, currentPassword, newPassword);
      replaceRow(next);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setNote("Your password has been updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change password");
    } finally {
      setSaving(false);
    }
  };

  const handleCreateUser = async () => {
    if (!newUser.username.trim() || !newUser.name.trim() || newUser.password.length < 8 || newUser.roleCodes.length === 0) {
      setError("Username, display name, an 8-character temporary password and at least one role are required.");
      return;
    }
    setSaving(true); setError(""); setNote("");
    try {
      const created = await createManagedUser({
        username: newUser.username.trim(), name: newUser.name.trim(), password: newUser.password,
        hospitalId: newUser.hospitalId.trim() || undefined,
        staffDirectoryId: newUser.staffDirectoryId ? Number(newUser.staffDirectoryId) : null,
        roleCodes: newUser.roleCodes,
      });
      setRows(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedUserId(created.id);
      setNewUser({ username: "", name: "", password: "", hospitalId: "", staffDirectoryId: "", roleCodes: ["clinician"] });
      setShowCreate(false);
      setNote(`${created.username} created. They must change the temporary password after signing in.`);
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to create user"); }
    finally { setSaving(false); }
  };

  const handleSaveAccess = async () => {
    if (!selected || accessRoles.length === 0) return;
    setSaving(true); setError(""); setNote("");
    try {
      const next = await updateManagedUserAccess(selected.id, accessRoles);
      replaceRow(next);
      setNote(`Access updated for ${next.username}.`);
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to update access"); }
    finally { setSaving(false); }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-lg font-semibold text-[var(--app-text)]">{isAdmin ? "Users" : "My Account"}</div>
          <div className="text-sm text-[var(--app-muted)]">
            {isAdmin
              ? "Review local accounts, activation state, and passwords."
              : "Review your account details and change your password."}
          </div>
        </div>
        {isAdmin ? (
          <div className="flex gap-2">
            <button type="button" className="rounded bg-[var(--app-accent)] px-3 py-2 text-sm font-semibold text-[var(--app-accent-contrast)]" onClick={() => setShowCreate(value => !value)}>
              {showCreate ? "Cancel" : "+ New user"}
            </button>
            <button type="button" className="rounded border border-[var(--app-border)] px-3 py-2 text-sm" onClick={() => void loadUsers()} disabled={loading || saving}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        ) : null}
      </div>

      {isAdmin && showCreate ? (
        <section className="rounded-lg border border-[var(--app-border)] bg-[var(--app-panel-bg)] p-4">
          <div className="mb-3 text-sm font-semibold">Create user</div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="text-xs text-[var(--app-muted)]">Username<input className="mt-1 w-full rounded border border-[var(--app-border)] px-3 py-2 text-sm" value={newUser.username} onChange={e => setNewUser(v => ({ ...v, username: e.target.value }))} /></label>
            <label className="text-xs text-[var(--app-muted)]">Display name<input className="mt-1 w-full rounded border border-[var(--app-border)] px-3 py-2 text-sm" value={newUser.name} onChange={e => setNewUser(v => ({ ...v, name: e.target.value }))} /></label>
            <label className="text-xs text-[var(--app-muted)]">Temporary password<input type="password" className="mt-1 w-full rounded border border-[var(--app-border)] px-3 py-2 text-sm" value={newUser.password} onChange={e => setNewUser(v => ({ ...v, password: e.target.value }))} /></label>
            <label className="text-xs text-[var(--app-muted)]">Hospital ID<input className="mt-1 w-full rounded border border-[var(--app-border)] px-3 py-2 text-sm" value={newUser.hospitalId} onChange={e => setNewUser(v => ({ ...v, hospitalId: e.target.value }))} /></label>
            <label className="text-xs text-[var(--app-muted)] md:col-span-2">Staff profile<select className="mt-1 w-full rounded border border-[var(--app-border)] px-3 py-2 text-sm" value={newUser.staffDirectoryId} onChange={e => setNewUser(v => ({ ...v, staffDirectoryId: e.target.value }))}><option value="">Not linked</option>{staffDirectory.filter(staff => staff.is_active !== 0).map(staff => <option key={staff.id} value={staff.id}>{staff.name} · {staff.role}</option>)}</select></label>
            <div className="md:col-span-2"><div className="mb-1 text-xs text-[var(--app-muted)]">Access roles</div><div className="flex flex-wrap gap-2">{roles.filter(role => role.isActive).map(role => <label key={role.code} className="inline-flex items-center gap-2 rounded border border-[var(--app-border)] px-3 py-2 text-xs"><input type="checkbox" checked={newUser.roleCodes.includes(role.code)} onChange={() => setNewUser(v => ({ ...v, roleCodes: v.roleCodes.includes(role.code) ? v.roleCodes.filter(code => code !== role.code) : [...v.roleCodes, role.code] }))} />{role.displayName}</label>)}</div></div>
          </div>
          <button type="button" className="mt-3 rounded bg-[var(--app-accent)] px-4 py-2 text-sm font-semibold text-[var(--app-accent-contrast)] disabled:opacity-50" disabled={saving} onClick={() => void handleCreateUser()}>{saving ? "Creating..." : "Create user"}</button>
        </section>
      ) : null}

      {error ? (
        <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      ) : null}
      {note ? (
        <div className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
          {note}
        </div>
      ) : null}

      <div className={`grid min-h-0 flex-1 gap-4 ${isAdmin ? "lg:grid-cols-[minmax(420px,0.95fr)_minmax(340px,0.75fr)]" : "lg:grid-cols-[minmax(320px,0.7fr)_minmax(420px,1fr)]"}`}>
        {isAdmin ? (
          <section className="flex min-h-0 flex-col rounded-lg border border-[var(--app-border)] bg-[var(--app-panel-bg)] p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <input
                className="min-w-[220px] flex-1 rounded border border-[var(--app-border)] px-3 py-2 text-sm"
                placeholder="Search username, name, hospital ID, role"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              <label className="inline-flex items-center gap-2 text-sm text-[var(--app-muted)]">
                <input
                  type="checkbox"
                  checked={includeInactive}
                  onChange={e => setIncludeInactive(e.target.checked)}
                />
                Show inactive
              </label>
            </div>

            <div className="min-h-0 flex-1 overflow-auto rounded border border-[var(--app-border)]">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-[var(--app-control-bg)] text-left">
                  <tr>
                    <th className="border-b border-[var(--app-border)] px-3 py-2">Username</th>
                    <th className="border-b border-[var(--app-border)] px-3 py-2">Name</th>
                    <th className="border-b border-[var(--app-border)] px-3 py-2">Source</th>
                    <th className="border-b border-[var(--app-border)] px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => {
                    const selectedRow = selected?.id === row.id;
                    return (
                      <tr
                        key={row.id}
                        className={`cursor-pointer ${selectedRow ? "bg-sky-500/10" : ""}`}
                        onClick={() => setSelectedUserId(row.id)}
                      >
                        <td className="border-b border-[var(--app-border)] px-3 py-2 font-medium">{row.username}</td>
                        <td className="border-b border-[var(--app-border)] px-3 py-2">{row.name}</td>
                        <td className="border-b border-[var(--app-border)] px-3 py-2">{sourceLabel(row.authSource)}</td>
                        <td className="border-b border-[var(--app-border)] px-3 py-2">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                              row.isActive
                                ? "bg-emerald-500/15 text-emerald-300"
                                : "bg-slate-500/15 text-slate-300"
                            }`}
                          >
                            {row.isActive ? "Active" : "Inactive"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-6 text-center text-sm text-[var(--app-muted)]">
                        {loading ? "Loading users..." : "No users found."}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <section className="rounded-lg border border-[var(--app-border)] bg-[var(--app-panel-bg)] p-4 shadow-sm">
            {selected ? (
              <div className="space-y-4">
                <div>
                  <div className="text-lg font-semibold text-[var(--app-text)]">{selected.name}</div>
                  <div className="text-sm text-[var(--app-muted)]">@{selected.username}</div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wide text-[var(--app-muted)]">Role</div>
                    <div className="mt-1 text-sm">{selected.role || "-"}</div>
                  </div>
                  <div className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wide text-[var(--app-muted)]">Status</div>
                    <div className="mt-1 text-sm">{selected.isActive ? "Active" : "Inactive"}</div>
                  </div>
                  <div className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wide text-[var(--app-muted)]">Hospital ID</div>
                    <div className="mt-1 text-sm">{selected.hospitalId || "-"}</div>
                  </div>
                  <div className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wide text-[var(--app-muted)]">Last Login</div>
                    <div className="mt-1 text-sm">{formatDateTime(selected.lastLoginAt)}</div>
                  </div>
                </div>

                {/* Case list */}
                <div className="space-y-2">
                  <div className="text-sm font-medium text-[var(--app-text)]">
                    My Cases
                    {myCasesLoading ? (
                      <span className="ml-2 text-xs text-[var(--app-muted)]">Loading...</span>
                    ) : (
                      <span className="ml-2 text-xs text-[var(--app-muted)]">({myCases.length})</span>
                    )}
                  </div>
                  {!selected.hospitalId ? (
                    <div className="text-xs text-[var(--app-muted)]">No Hospital ID linked — cases cannot be matched.</div>
                  ) : myCases.length === 0 && !myCasesLoading ? (
                    <div className="text-xs text-[var(--app-muted)]">No cases found.</div>
                  ) : (
                    <div className="overflow-auto rounded border border-[var(--app-border)]" style={{ maxHeight: 260 }}>
                      <table className="w-full border-collapse text-xs">
                        <thead className="sticky top-0 bg-[var(--app-control-bg)]">
                          <tr>
                            <th className="border-b border-[var(--app-border)] px-2 py-1.5 text-left">HN</th>
                            <th className="border-b border-[var(--app-border)] px-2 py-1.5 text-left">Date</th>
                            <th className="border-b border-[var(--app-border)] px-2 py-1.5 text-left">Role</th>
                            <th className="border-b border-[var(--app-border)] px-2 py-1.5 text-left">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {myCases.map(c => (
                            <tr key={c.id} className="hover:bg-[var(--app-control-bg)]">
                              <td className="border-b border-[var(--app-border)] px-2 py-1.5 font-medium">{c.hn}</td>
                              <td className="border-b border-[var(--app-border)] px-2 py-1.5">{formatDateTime(c.start_time)}</td>
                              <td className="border-b border-[var(--app-border)] px-2 py-1.5">{c.staff_role}</td>
                              <td className="border-b border-[var(--app-border)] px-2 py-1.5">
                                <span className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                                  c.status === "active"
                                    ? "bg-emerald-500/15 text-emerald-400"
                                    : "bg-slate-500/15 text-[var(--app-muted)]"
                                }`}>
                                  {c.status}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-sm text-[var(--app-muted)]">
                {loading ? "Loading your account..." : "Your account details are not available."}
              </div>
            )}
          </section>
        )}

        <aside className="min-h-0 overflow-y-auto rounded-lg border border-[var(--app-border)] bg-[var(--app-panel-bg)] p-4 shadow-sm">
          {selected ? (
            <div className="space-y-4">
              <div>
                <div className="text-lg font-semibold text-[var(--app-text)]">{selected.username}</div>
                <div className="text-sm text-[var(--app-muted)]">{selected.name}</div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-[var(--app-muted)]">Role</div>
                  <div className="mt-1 text-sm">{selected.role || "-"}</div>
                </div>
                <div className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-[var(--app-muted)]">Source</div>
                  <div className="mt-1 text-sm">{sourceLabel(selected.authSource)}</div>
                </div>
                <div className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-[var(--app-muted)]">Hospital ID</div>
                  <div className="mt-1 text-sm">{selected.hospitalId || "-"}</div>
                </div>
                <div className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-[var(--app-muted)]">Last Login</div>
                  <div className="mt-1 text-sm">{formatDateTime(selected.lastLoginAt)}</div>
                </div>
              </div>

              {isAdmin ? (
                <>
                  <div className="space-y-3 rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] p-3">
                    <div><div className="text-sm font-medium">Access roles</div><div className="text-xs text-[var(--app-muted)]">Permissions are enforced by the API.</div></div>
                    <div className="space-y-2">{roles.filter(role => role.isActive).map(role => <label key={role.code} className="flex items-start gap-2 rounded border border-[var(--app-border)] p-2"><input type="checkbox" className="mt-0.5" checked={accessRoles.includes(role.code)} onChange={() => setAccessRoles(current => current.includes(role.code) ? current.filter(code => code !== role.code) : [...current, role.code])} /><span><span className="block text-sm font-medium">{role.displayName}</span><span className="block text-xs text-[var(--app-muted)]">{role.description}</span></span></label>)}</div>
                    <button type="button" className="rounded border border-[var(--app-border)] px-3 py-2 text-sm font-medium disabled:opacity-45" disabled={saving || accessRoles.length === 0} onClick={() => void handleSaveAccess()}>Save access</button>
                  </div>

                  <div className="space-y-2 rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] p-3">
                    <div className="text-sm font-medium">Staff profile</div>
                    <select
                      className="w-full rounded border border-[var(--app-border)] px-3 py-2 text-sm"
                      value={selected.staffDirectoryId ?? ""}
                      disabled={saving}
                      onChange={event => void handleStaffLink(event.target.value ? Number(event.target.value) : null)}
                    >
                      <option value="">No linked staff profile</option>
                      {staffDirectory.map(staff => <option key={staff.id} value={staff.id}>{staff.name} · {staff.role}{staff.hospital_id ? ` · ${staff.hospital_id}` : ""}{staff.is_active === 0 ? " · inactive" : ""}</option>)}
                    </select>
                    <div className="text-xs text-[var(--app-muted)]">Links login identity to the clinician directory and their case history.</div>
                  </div>

                  <div className="space-y-2 rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] p-3">
                    <div className="text-sm font-medium">Account State</div>
                    <div className="text-xs text-[var(--app-muted)]">
                      {selected.isActive
                        ? "This user can sign in."
                        : "This user is blocked from signing in until reactivated."}
                    </div>
                    <button
                      type="button"
                      className={`rounded border px-3 py-2 text-sm font-medium ${
                        selected.isActive
                          ? "border-red-400/35 bg-red-500/10 text-red-100"
                          : "border-emerald-400/35 bg-emerald-500/10 text-emerald-100"
                      } disabled:cursor-not-allowed disabled:opacity-45`}
                      disabled={saving}
                      onClick={() => void handleToggleActive()}
                    >
                      {saving ? "Saving..." : selected.isActive ? "Deactivate User" : "Activate User"}
                    </button>
                  </div>

                  <div className="space-y-3 rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] p-3">
                    <div>
                      <div className="text-sm font-medium">Password</div>
                      <div className="text-xs text-[var(--app-muted)]">
                        Reset to the default password or set a custom one for this user.
                      </div>
                    </div>

                    <div className="text-xs text-[var(--app-muted)]">
                      Default password: {selected.authSource === "staff" ? "flora" : selected.hospitalId ? selected.hospitalId : "Not available"}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded border border-amber-400/35 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-100 disabled:cursor-not-allowed disabled:opacity-45"
                        disabled={saving || !selected.hospitalId}
                        onClick={() => void handleResetPassword("default")}
                      >
                        Reset Default
                      </button>
                    </div>

                    <div className="space-y-2">
                      <input
                        className="w-full rounded border border-[var(--app-border)] px-3 py-2 text-sm"
                        placeholder="New custom password"
                        value={customPassword}
                        onChange={e => setCustomPassword(e.target.value)}
                        disabled={saving}
                      />
                      <button
                        type="button"
                        className="rounded border border-[var(--app-border)] px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-45"
                        disabled={saving || customPassword.trim().length === 0}
                        onClick={() => void handleResetPassword("custom")}
                      >
                        Set Custom Password
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="space-y-3 rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] p-3">
                  <div>
                    <div className="text-sm font-medium">Change Password</div>
                    <div className="text-xs text-[var(--app-muted)]">
                      Use your current password to set a new one for your account.
                    </div>
                  </div>

                  <div className="space-y-2">
                    <input
                      type="password"
                      className="w-full rounded border border-[var(--app-border)] px-3 py-2 text-sm"
                      placeholder="Current password"
                      value={currentPassword}
                      onChange={e => setCurrentPassword(e.target.value)}
                      disabled={saving}
                    />
                    <input
                      type="password"
                      className="w-full rounded border border-[var(--app-border)] px-3 py-2 text-sm"
                      placeholder="New password"
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      disabled={saving}
                    />
                    <input
                      type="password"
                      className="w-full rounded border border-[var(--app-border)] px-3 py-2 text-sm"
                      placeholder="Confirm new password"
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      disabled={saving}
                    />
                    <button
                      type="button"
                      className="rounded border border-[var(--app-border)] px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-45"
                      disabled={
                        saving ||
                        currentPassword.trim().length === 0 ||
                        newPassword.trim().length === 0 ||
                        confirmPassword.trim().length === 0
                      }
                      onClick={() => void handleChangeOwnPassword()}
                    >
                      Change Password
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm text-[var(--app-muted)]">
              {loading ? "Loading account..." : isAdmin ? "Select a user to manage the account." : "Your account is not available."}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
