import { useEffect, useMemo, useState } from "react";
import {
  changeOwnPassword,
  getPreferenceOptions,
  getSelfManagedUser,
  mergeStoredAuthUser,
  updateOwnPreferences,
  type ManagedAuthUser,
  type PreferenceOptions,
} from "../api/authApi";
import { getStaffDirectory, type StaffLibraryItem } from "../api/staffApi";
import type { AuthUser } from "../auth/useAuth";

const PARAMETERS = [
  ["hr", "Heart rate"], ["spo2", "SpO₂"], ["nibp", "NIBP"],
  ["art", "Arterial pressure"], ["cvp", "CVP"], ["temperature", "Temperature"],
] as const;
const REPORT_SECTIONS = [
  ["patient", "Patient"], ["clinical", "Clinical summary"], ["careTeam", "Care team"],
  ["chart", "Chart"], ["io", "I/O"], ["forms", "Forms"],
] as const;

export default function AccountView({ sessionUser }: { sessionUser: AuthUser | null }) {
  const [account, setAccount] = useState<ManagedAuthUser | null>(null);
  const [options, setOptions] = useState<PreferenceOptions | null>(null);
  const [staff, setStaff] = useState<StaffLibraryItem[]>([]);
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("en");
  const [scheme, setScheme] = useState("monochromatic");
  const [scale, setScale] = useState(5);
  const [parameters, setParameters] = useState<string[]>(PARAMETERS.map(([key]) => key));
  const [reports, setReports] = useState<Record<string, boolean>>(() => Object.fromEntries(REPORT_SECTIONS.map(([key]) => [key, true])));
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      getSelfManagedUser(sessionUser?.username || ""),
      getPreferenceOptions(),
      getStaffDirectory({ include_inactive: true, limit: 500 }).catch(() => []),
    ]).then(([user, preferenceOptions, directory]) => {
      setAccount(user); setOptions(preferenceOptions); setStaff(directory);
      setName(user.name); setLanguage(String(user.languageCode || preferenceOptions.defaultLanguage));
      setScheme(String(user.themeColor || preferenceOptions.defaultTheme));
      const parameterPrefs = user.parameterPreferences || {};
      setScale(Number(parameterPrefs.timeScaleMin) || 5);
      if (Array.isArray(parameterPrefs.visibleParameters)) setParameters(parameterPrefs.visibleParameters.map(String));
      setReports(current => ({ ...current, ...(user.reportPreferences as Record<string, boolean>) }));
    }).catch(err => setError(err instanceof Error ? err.message : "Unable to load account"));
  }, [sessionUser?.username]);

  const linkedStaff = useMemo(() => staff.find(row => row.id === account?.staffDirectoryId), [account?.staffDirectoryId, staff]);
  const toggleParameter = (key: string) => setParameters(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key]);

  const save = async () => {
    setSaving(true); setError(""); setMessage("");
    try {
      const next = await updateOwnPreferences({
        name: name.trim(), languageCode: language, themeMode: "dark", themeColor: scheme,
        parameterPreferences: { timeScaleMin: scale, visibleParameters: parameters },
        reportPreferences: reports,
      });
      mergeStoredAuthUser(next);
      window.dispatchEvent(new Event("flora:auth-changed"));
      setAccount(current => current ? { ...current, name: next.name, languageCode: next.languageCode, themeColor: next.themeColor,
        parameterPreferences: next.parameterPreferences || {}, reportPreferences: next.reportPreferences || {} } : current);
      setMessage("Account settings saved.");
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to save account"); }
    finally { setSaving(false); }
  };

  const changePassword = async () => {
    if (newPassword.length < 8) return setError("New password must be at least 8 characters.");
    if (newPassword !== confirmPassword) return setError("Passwords do not match.");
    setSaving(true); setError(""); setMessage("");
    try {
      const changed = await changeOwnPassword(sessionUser?.username || "", currentPassword, newPassword);
      mergeStoredAuthUser(changed);
      window.dispatchEvent(new Event("flora:auth-changed"));
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword(""); setMessage("Password changed.");
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to change password"); }
    finally { setSaving(false); }
  };

  return <div className="mx-auto flex h-full w-full max-w-[1180px] flex-col gap-4 overflow-y-auto p-4 md:p-6">
    <header><h1 className="text-xl font-bold text-[var(--app-text)]">Account settings</h1><p className="text-sm text-[var(--app-muted)]">Personal profile and workspace preferences</p></header>
    {error ? <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div> : null}
    {message ? <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{message}</div> : null}
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="space-y-4 rounded-xl border border-[var(--app-border)] bg-[var(--app-panel-bg)] p-5">
        <h2 className="font-semibold">Profile</h2>
        <label className="block text-sm">Display name<input className="mt-1 w-full max-w-xl rounded-lg border border-[var(--app-border)] px-3 py-2" value={name} onChange={e => setName(e.target.value)} /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg bg-[var(--app-control-bg)] p-3"><div className="text-xs text-[var(--app-muted)]">Username</div><div className="font-medium">{account?.username || "—"}</div></div>
          <div className="rounded-lg bg-[var(--app-control-bg)] p-3"><div className="text-xs text-[var(--app-muted)]">Role</div><div className="font-medium">{account?.role || "—"}</div></div>
        </div>
        <div className="rounded-lg border border-[var(--app-border)] p-3"><div className="text-xs text-[var(--app-muted)]">Linked staff profile</div><div className="mt-1 font-semibold">{linkedStaff?.name || "Not linked"}</div>{linkedStaff ? <div className="text-xs text-[var(--app-muted)]">{linkedStaff.role}{linkedStaff.hospital_id ? ` · ${linkedStaff.hospital_id}` : ""}</div> : <div className="text-xs text-amber-300">Ask an administrator to link this account in Config → User.</div>}</div>
      </section>
      <section className="space-y-4 rounded-xl border border-[var(--app-border)] bg-[var(--app-panel-bg)] p-5">
        <h2 className="font-semibold">Appearance</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Preferred language<select className="mt-1 w-full rounded-lg border border-[var(--app-border)] px-3 py-2" value={language} onChange={e => setLanguage(e.target.value)}>{options?.languages.map(row => <option key={row.code} value={row.code}>{row.nameNative}</option>)}</select></label>
          <label className="text-sm">Preferred scheme<select className="mt-1 w-full rounded-lg border border-[var(--app-border)] px-3 py-2" value={scheme} onChange={e => setScheme(e.target.value)}>{options?.themes.map(row => <option key={row.code} value={row.code}>{row.displayName}</option>)}</select></label>
        </div>
        <div className="flex flex-wrap gap-2">{options?.themes.find(row => row.code === scheme)?.colors.map((color, index) => <span key={index} className="h-10 w-10 rounded-lg border border-white/15" style={{ backgroundColor: color }} title={color} />)}</div>
      </section>
      <section className="space-y-4 rounded-xl border border-[var(--app-border)] bg-[var(--app-panel-bg)] p-5">
        <h2 className="font-semibold">Chart preferences</h2>
        <label className="block max-w-xs text-sm">Default time scale<select className="mt-1 w-full rounded-lg border border-[var(--app-border)] px-3 py-2" value={scale} onChange={e => setScale(Number(e.target.value))}>{[1,5,10,15,30,60].map(value => <option key={value} value={value}>{value} min</option>)}</select></label>
        <div className="grid gap-2 sm:grid-cols-2">{PARAMETERS.map(([key, label]) => <label key={key} className="flex items-center gap-2 rounded-lg border border-[var(--app-border)] px-3 py-2 text-sm"><input type="checkbox" checked={parameters.includes(key)} onChange={() => toggleParameter(key)} />{label}</label>)}</div>
      </section>
      <section className="space-y-4 rounded-xl border border-[var(--app-border)] bg-[var(--app-panel-bg)] p-5">
        <h2 className="font-semibold">Report preferences</h2>
        <div className="grid gap-2 sm:grid-cols-2">{REPORT_SECTIONS.map(([key, label]) => <label key={key} className="flex items-center gap-2 rounded-lg border border-[var(--app-border)] px-3 py-2 text-sm"><input type="checkbox" checked={reports[key] !== false} onChange={e => setReports(current => ({ ...current, [key]: e.target.checked }))} />{label}</label>)}</div>
      </section>
    </div>
    <button type="button" onClick={() => void save()} disabled={saving || !name.trim()} className="w-fit rounded-lg bg-[var(--app-accent)] px-5 py-2.5 font-semibold text-[var(--app-accent-contrast)] disabled:opacity-50">{saving ? "Saving…" : "Save account"}</button>
    <section className="space-y-3 rounded-xl border border-[var(--app-border)] bg-[var(--app-panel-bg)] p-5"><h2 className="font-semibold">Password</h2><div className="grid max-w-3xl gap-3 sm:grid-cols-3"><input type="password" className="rounded-lg border border-[var(--app-border)] px-3 py-2" placeholder="Current password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} /><input type="password" className="rounded-lg border border-[var(--app-border)] px-3 py-2" placeholder="New password" value={newPassword} onChange={e => setNewPassword(e.target.value)} /><input type="password" className="rounded-lg border border-[var(--app-border)] px-3 py-2" placeholder="Confirm password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} /></div><button type="button" onClick={() => void changePassword()} disabled={saving || !currentPassword || !newPassword || !confirmPassword} className="rounded-lg border border-[var(--app-border)] px-4 py-2 text-sm font-semibold disabled:opacity-50">Change password</button></section>
  </div>;
}
