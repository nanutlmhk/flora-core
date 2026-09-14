import { useEffect, useMemo, useState } from "react";
import type { CaseStatus } from "../api/caseApi";
import type { AuthUser } from "../auth/useAuth";
import { getEditionInfo } from "../edition/config";
import UsersView from "./UsersView";
import DrugView from "./DrugView";
import StaffView from "./StaffView";

type ManageTab = "user" | "fluids" | "staff" | "database" | "license";

type Props = {
  caseStatus: CaseStatus;
  sessionUser: AuthUser | null;
};

const tabLabel: Record<ManageTab, string> = {
  user: "User",
  fluids: "Fluid & Med",
  staff: "Staff",
  database: "Database",
  license: "License",
};

const card =
  "rounded-lg border border-[var(--app-border)] bg-[var(--app-panel-bg)] p-4 space-y-4";
const input =
  "w-full rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2 text-sm";
const buttonPrimary =
  "rounded bg-[var(--app-accent)] px-3 py-2 text-sm font-semibold text-white hover:brightness-110";
const buttonSecondary =
  "rounded border border-[var(--app-border)] px-3 py-2 text-sm text-[var(--app-text)] hover:bg-[var(--app-hover-bg)]";

const MACHINE_ID_STORAGE_KEY = "flora.eforl.machineId";
const LICENSE_STORAGE_KEY = "flora.eforl.license";

type LicenseState = {
  activationCode: string;
  activatedAt: string;
  expiresAt: string;
};

function readOrCreateMachineId() {
  if (typeof window === "undefined") return "EFL-UNKNOWN";
  const existing = window.localStorage.getItem(MACHINE_ID_STORAGE_KEY);
  if (existing) return existing;
  const seed = Math.random().toString(36).slice(2, 10).toUpperCase();
  const next = `EFL-${seed.slice(0, 4)}-${seed.slice(4, 8)}`;
  window.localStorage.setItem(MACHINE_ID_STORAGE_KEY, next);
  return next;
}

function buildRequestCode(machineId: string) {
  const raw = `PORJAI|EFORL|${machineId}|1Y`;
  if (typeof window === "undefined") return raw;
  return window.btoa(raw).replace(/=/g, "");
}

function readLicenseState(): LicenseState | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(LICENSE_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as LicenseState;
    if (!parsed.activationCode || !parsed.expiresAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveLicenseState(next: LicenseState | null) {
  if (typeof window === "undefined") return;
  if (!next) {
    window.localStorage.removeItem(LICENSE_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(LICENSE_STORAGE_KEY, JSON.stringify(next));
}

function addOneYearIso(fromTs: number) {
  const next = new Date(fromTs);
  next.setFullYear(next.getFullYear() + 1);
  return next.toISOString();
}

function formatDateText(iso: string) {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(ts);
}

function formatMonthValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function formatCountdown(targetIso: string, nowTs: number) {
  const targetTs = Date.parse(targetIso);
  if (!Number.isFinite(targetTs)) return "-";
  const diff = targetTs - nowTs;
  if (diff <= 0) return "Expired";
  const totalMinutes = Math.floor(diff / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  return `${days}d ${hours}h ${minutes}m remaining`;
}

function DatabaseTab() {
  const today = new Date();
  const fromDefault = new Date(today.getFullYear(), Math.max(0, today.getMonth() - 2), 1);
  const [fromMonth, setFromMonth] = useState(formatMonthValue(fromDefault));
  const [toMonth, setToMonth] = useState(formatMonthValue(today));
  const [note, setNote] = useState("No export generated yet.");

  return (
    <div className="p-4 space-y-4">
      <div className={card}>
        <div>
          <div className="text-sm font-semibold">Database Export</div>
          <div className="text-xs text-[var(--app-muted)]">Prepare export packages for case data and master data library.</div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1">
            <div className="text-xs text-[var(--app-muted)]">From Month / Year</div>
            <input type="month" className={input} value={fromMonth} onChange={event => setFromMonth(event.target.value)} />
          </label>
          <label className="space-y-1">
            <div className="text-xs text-[var(--app-muted)]">To Month / Year</div>
            <input type="month" className={input} value={toMonth} onChange={event => setToMonth(event.target.value)} />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={buttonPrimary}
            onClick={() =>
              setNote(`Cases export prepared for ${fromMonth} to ${toMonth}.`)
            }
          >
            Export Cases Data
          </button>
          <button
            type="button"
            className={buttonSecondary}
            onClick={() => setNote("Master data library export prepared.")}
          >
            Export Master Data Library
          </button>
        </div>
        <div className="rounded border border-dashed border-[var(--app-border)] px-3 py-2 text-sm text-[var(--app-muted)]">
          {note}
        </div>
      </div>
    </div>
  );
}

function LicenseTab() {
  const machineId = useMemo(() => readOrCreateMachineId(), []);
  const [activationInput, setActivationInput] = useState("");
  const [requestCode, setRequestCode] = useState("");
  const [statusNote, setStatusNote] = useState("Pending activation.");
  const [licenseState, setLicenseState] = useState<LicenseState | null>(() => readLicenseState());
  const [nowTs, setNowTs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowTs(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  const activateLicense = () => {
    const code = activationInput.trim();
    if (!code) {
      setStatusNote("Enter activation code first.");
      return;
    }
    const nowIso = new Date().toISOString();
    const next: LicenseState = {
      activationCode: code,
      activatedAt: nowIso,
      expiresAt: addOneYearIso(Date.now()),
    };
    saveLicenseState(next);
    setLicenseState(next);
    setActivationInput("");
    setStatusNote("Completed");
  };

  return (
    <div className="p-4 space-y-4">
      <div className={card}>
        <div>
          <div className="text-sm font-semibold">Yearly License Activation</div>
          <div className="text-xs text-[var(--app-muted)]">Activate this workstation for another one-year license period.</div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1">
            <div className="text-xs text-[var(--app-muted)]">Machine ID</div>
            <input className={input} readOnly value={machineId} />
          </label>
          <label className="space-y-1">
            <div className="text-xs text-[var(--app-muted)]">Request Code</div>
            <input className={input} readOnly value={requestCode} />
          </label>
        </div>

        <label className="space-y-1">
          <div className="text-xs text-[var(--app-muted)]">Activation Code</div>
          <textarea
            className={`${input} min-h-24`}
            placeholder="Paste activation code from Porjai website"
            value={activationInput}
            onChange={event => setActivationInput(event.target.value)}
          />
        </label>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={buttonPrimary}
            onClick={() => {
              const nextRequestCode = buildRequestCode(machineId);
              setRequestCode(nextRequestCode);
              setStatusNote("Request code generated.");
            }}
          >
            Generate Request Code
          </button>
          <button
            type="button"
            className={buttonSecondary}
            onClick={() => {
              navigator.clipboard?.writeText(requestCode).catch(() => {});
              setStatusNote("Request code copied.");
            }}
          >
            Copy Request Code
          </button>
          <button type="button" className={buttonSecondary} onClick={activateLicense}>
            Activate License
          </button>
        </div>

        <div className="rounded border border-dashed border-[var(--app-border)] p-3 text-sm space-y-1">
          <div className="font-medium">{licenseState ? "Status: Completed" : "Status: Pending"}</div>
          {licenseState ? (
            <>
              <div className="text-xs text-[var(--app-muted)]">
                License activate until {licenseState.expiresAt.slice(0, 10)}
              </div>
              <div className="text-xs text-[var(--app-muted)]">{formatCountdown(licenseState.expiresAt, nowTs)}</div>
            </>
          ) : (
            <div className="text-xs text-[var(--app-muted)]">No activation record stored yet.</div>
          )}
          <div className="text-xs text-[var(--app-muted)]">
            {licenseState ? (
              <>
                Activated: {formatDateText(licenseState.activatedAt)}
                {" | "}
                Expires: {formatDateText(licenseState.expiresAt)}
              </>
            ) : (
              "Waiting for activation."
            )}
          </div>
        </div>

        <div className="rounded border border-dashed border-[var(--app-border)] px-3 py-2 text-sm text-[var(--app-muted)]">
          {statusNote}
        </div>
      </div>
    </div>
  );
}

export default function ManageView({ caseStatus, sessionUser }: Props) {
  const edition = getEditionInfo();
  const isAdmin = String(sessionUser?.role || "").trim().toLowerCase() === "admin";
  const isEforl = edition.code === "eforl";
  const availableTabs = useMemo<ManageTab[]>(
    () =>
      isAdmin
        ? isEforl
          ? ["user", "fluids", "staff", "database", "license"]
          : ["user", "fluids", "staff"]
        : ["user"],
    [isAdmin, isEforl],
  );
  const [tab, setTab] = useState<ManageTab>("user");
  const activeTab = availableTabs.includes(tab) ? tab : availableTabs[0];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {availableTabs.length > 1 && (
        <div className="flex shrink-0 items-center gap-0 border-b border-[var(--app-border)] px-4">
          {availableTabs.map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px ${
                activeTab === t
                  ? "border-[var(--app-accent)] text-[var(--app-accent)]"
                  : "border-transparent text-[var(--app-muted)] hover:text-[var(--app-text)]"
              }`}
            >
              {tabLabel[t]}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {activeTab === "user" ? (
          <UsersView sessionUser={sessionUser} />
        ) : activeTab === "fluids" ? (
          <DrugView caseStatus={caseStatus} mode="master" />
        ) : activeTab === "staff" ? (
          <StaffView caseStatus={caseStatus} sessionUser={sessionUser} defaultTab="master" />
        ) : activeTab === "database" ? (
          <DatabaseTab />
        ) : (
          <LicenseTab />
        )}
      </div>
    </div>
  );
}
