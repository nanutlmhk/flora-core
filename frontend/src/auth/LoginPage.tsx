import { useState, type ReactNode } from "react";
import type { BootstrapStatus } from "../bootstrap/aidasDesktop";
import aidasAppIcon from "../assets/aidas-app.png";

type Props = {
  onLogin: (username: string, password: string) => Promise<boolean> | boolean;
  loginEnabled?: boolean;
  bootstrapStatus?: BootstrapStatus;
  onRetryStart?: () => Promise<unknown> | unknown;
  onSafeRecovery?: () => Promise<unknown> | unknown;
  onStopBackend?: () => Promise<unknown> | unknown;
  onShutdown?: () => Promise<unknown> | unknown;
  sessionUserName?: string;
};

function AidasLogo() {
  return <img src={aidasAppIcon} alt="" className="h-10 w-10 object-contain" />;
}

function StatusIcon({
  kind,
  tone = "neutral",
}: {
  kind: "backend" | "database" | "device" | "recovery";
  tone?: "good" | "warn" | "bad" | "neutral";
}) {
  const palette =
    tone === "good"
      ? "bg-emerald-500/15 text-emerald-300 ring-emerald-400/30"
      : tone === "warn"
      ? "bg-amber-500/15 text-amber-200 ring-amber-300/30"
      : tone === "bad"
      ? "bg-red-500/15 text-red-300 ring-red-400/30"
      : "bg-white/8 text-slate-200 ring-white/10";

  if (kind === "backend") {
    return (
      <span className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ring-1 ${palette}`}>
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="4" y="5" width="16" height="6" rx="1.5" />
          <rect x="4" y="13" width="16" height="6" rx="1.5" />
          <path d="M8 8h.01M8 16h.01M12 8h5M12 16h5" />
        </svg>
      </span>
    );
  }
  if (kind === "database") {
    return (
      <span className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ring-1 ${palette}`}>
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
          <ellipse cx="12" cy="6" rx="7" ry="3" />
          <path d="M5 6v8c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
          <path d="M5 10c0 1.7 3.1 3 7 3s7-1.3 7-3" />
        </svg>
      </span>
    );
  }
  if (kind === "device") {
    return (
      <span className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ring-1 ${palette}`}>
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M8 7v5" />
          <path d="M16 7v5" />
          <path d="M7 4h10v8a5 5 0 0 1-10 0V4Z" />
          <path d="M12 17v3" />
        </svg>
      </span>
    );
  }
  return (
    <span className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ring-1 ${palette}`}>
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 3v4" />
        <path d="M12 17v4" />
        <path d="M4.9 6.9l2.8 2.8" />
        <path d="M16.3 18.3l2.8 2.8" />
        <path d="M3 12h4" />
        <path d="M17 12h4" />
        <path d="M4.9 17.1l2.8-2.8" />
        <path d="M16.3 5.7l2.8-2.8" />
        <circle cx="12" cy="12" r="3.5" />
      </svg>
    </span>
  );
}

function StatusCard({
  icon,
  title,
  value,
  caption,
  actions,
  tone = "neutral",
}: {
  icon: "backend" | "database" | "device" | "recovery";
  title: string;
  value: string;
  caption: string;
  actions?: ReactNode;
  tone?: "good" | "warn" | "bad" | "neutral";
}) {
  const borderTone =
    tone === "good"
      ? "border-emerald-400/30 bg-emerald-500/6"
      : tone === "warn"
      ? "border-amber-400/30 bg-amber-500/6"
      : tone === "bad"
      ? "border-red-400/30 bg-red-500/6"
      : "border-[var(--app-border)] bg-[var(--app-panel-bg)]";

  return (
    <div className={`h-full rounded-2xl border p-4 ${borderTone}`}>
      <div className="flex h-full items-start gap-3">
        <StatusIcon kind={icon} tone={tone} />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--app-muted)]">{title}</div>
          <div className="mt-1 text-base font-semibold text-[var(--app-text)]">{value}</div>
          <div className="mt-1 break-words text-xs leading-5 text-[var(--app-muted)]">{caption}</div>
          {actions ? <div className="mt-auto flex flex-wrap gap-2 pt-3">{actions}</div> : null}
        </div>
      </div>
    </div>
  );
}

export default function LoginPage({
  onLogin,
  loginEnabled = true,
  bootstrapStatus,
  onRetryStart,
  onSafeRecovery,
  onStopBackend,
  onShutdown,
  sessionUserName = "",
}: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [busyAction, setBusyAction] = useState<"" | "retry" | "recover" | "stop">("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginEnabled) {
      setError("AIDAS is still starting. Please wait until system status is healthy.");
      return;
    }
    setIsLoggingIn(true);
    try {
      const ok = await onLogin(username, password);
      if (!ok) {
        setError("Sign-in failed. Check your username and password.");
        return;
      }
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const runAction = async (
    action: "" | "retry" | "recover" | "stop",
    fn?: () => Promise<unknown> | unknown,
  ) => {
    if (!fn) return;
    setBusyAction(action);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusyAction("");
    }
  };

  const backendState = bootstrapStatus?.backendState || "running";
  const systemReady = bootstrapStatus?.ready ?? true;
  const statusTone =
    backendState === "running"
      ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300"
      : backendState === "recovering" || backendState === "starting"
      ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-300"
      : "border-red-300 bg-red-50 text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300";
  const backendCardTone =
    backendState === "running" ? "good" : backendState === "recovering" || backendState === "starting" ? "warn" : "bad";
  const ivyCardTone =
    bootstrapStatus?.ivyState === "connected" ? "good" : bootstrapStatus?.ivyState === "disconnected" ? "bad" : "neutral";
  const recoveryCardTone = busyAction === "recover" ? "warn" : "neutral";
  const overallStatusText =
    backendState === "running" ? "Ready" : backendState === "recovering" ? "Recovering" : backendState === "starting" ? "Starting" : "Attention";
  const backendSummary =
    backendState === "running" ? "Running" : backendState === "recovering" ? "Recovering" : backendState === "starting" ? "Starting" : "Unavailable";
  const databaseSummary = bootstrapStatus?.dbExists ? "Healthy" : "Unavailable";
  const hidroSummary =
    bootstrapStatus?.ivyState === "connected"
      ? "Running"
      : bootstrapStatus?.ivyState === "disconnected"
      ? "Offline"
      : "Checking";
  const recoveryAvailable = Boolean(onSafeRecovery) && Boolean(bootstrapStatus?.dbWalExists || bootstrapStatus?.dbShmExists);
  const recoverySummary = recoveryAvailable ? "Available" : "Unavailable";
  const canRetryBackend = Boolean(onRetryStart) && backendState !== "running";
  const canStopBackend = Boolean(onStopBackend) && backendState === "running";

  return (
    <div className="h-screen flex items-center justify-center p-4 app-main app-theme-scope">
      <div className="w-full max-w-[1400px] rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-bg)] p-7 shadow-xl backdrop-blur">
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(320px,0.72fr)_minmax(620px,0.98fr)]">
          <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-control-bg)] p-6">
            <div className="mb-5">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl bg-sky-400/10 text-sky-300 ring-1 ring-sky-300/20">
                  <AidasLogo />
                </span>
                <div>
                  <div className="text-xl font-semibold text-[var(--app-text)]">
                    Aidas
                  </div>
                  <div className="text-xs text-[var(--app-muted)]">
                    Clinical desktop shell
                  </div>
                </div>
              </div>
              <div className="mt-4 text-xs text-[var(--app-muted)]">
                {systemReady
                  ? "Sign in to continue"
                  : sessionUserName
                  ? `Restoring system for ${sessionUserName}`
                  : "Starting services and checking local system health"}
              </div>
            </div>

            {error ? (
              <div className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300">
                {error}
              </div>
            ) : null}

            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-[var(--app-muted)]">
                  Username
                </label>
                <input
                  className="w-full rounded border border-[var(--app-border)] bg-white/90 px-3 py-2 text-sm text-[var(--app-text)] focus:outline-none focus:ring-2 focus:ring-blue-500/60 dark:bg-gray-950/70"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  autoComplete="username"
                  disabled={!systemReady || busyAction !== "" || isLoggingIn}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-[var(--app-muted)]">
                  Password
                </label>
                <input
                  type="password"
                  className="w-full rounded border border-[var(--app-border)] bg-white/90 px-3 py-2 text-sm text-[var(--app-text)] focus:outline-none focus:ring-2 focus:ring-blue-500/60 dark:bg-gray-950/70"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                  disabled={!systemReady || busyAction !== "" || isLoggingIn}
                />
              </div>

              <button
                type="submit"
                disabled={!systemReady || busyAction !== "" || isLoggingIn}
                className="w-full rounded bg-[var(--app-accent)] px-3 py-2 text-sm font-medium text-[var(--app-accent-contrast)] hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {!systemReady ? "Waiting For Services" : isLoggingIn ? "Signing In..." : "Sign In"}
              </button>
            </form>

            <div className="mt-4 space-y-1 text-xs text-[var(--app-muted)]">
              <div>Sign in with your AIDAS username and password.</div>
              <div>Staff accounts use `firstname.l` and the default password is `aidas`.</div>
            </div>

            {!systemReady ? (
              <div className="mt-4 rounded-lg border border-[var(--app-border)] bg-[var(--app-panel-bg)] p-3 text-xs text-[var(--app-muted)]">
                Login is temporarily disabled until backend and local database are ready.
              </div>
            ) : null}
          </div>

          <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-control-bg)] p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-[var(--app-text)]">
                  System Status
                </div>
                <div className="text-xs text-[var(--app-muted)]">
                  Backend, database, and Hidro
                </div>
              </div>
              <div className={`rounded-full border px-3 py-1 text-xs font-medium ${statusTone}`}>
                {overallStatusText}
              </div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <StatusCard
                icon="backend"
                title="Backend"
                value={backendSummary}
                caption={
                  backendState === "running"
                    ? "Local service port 3001 is ready"
                    : bootstrapStatus?.lastError || "Starting local service"
                }
                tone={backendCardTone}
                actions={
                  <>
                    <button
                      type="button"
                      className="rounded-lg border border-[var(--app-border)] px-3 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-45"
                      disabled={!canRetryBackend || busyAction !== ""}
                      onClick={() => void runAction("retry", onRetryStart)}
                    >
                      {busyAction === "retry" ? "Starting..." : "Start"}
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-red-400/35 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-100 disabled:cursor-not-allowed disabled:opacity-45"
                      disabled={!canStopBackend || busyAction !== ""}
                      onClick={() => void runAction("stop", onStopBackend)}
                    >
                      {busyAction === "stop" ? "Stopping..." : "Stop"}
                    </button>
                  </>
                }
              />
              <StatusCard
                icon="database"
                title="Database"
                value={databaseSummary}
                caption={
                  bootstrapStatus?.uncleanRecoveryApplied
                    ? "Automatic recovery applied"
                    : bootstrapStatus?.dbExists
                    ? "Local database ready"
                    : "Database file not found"
                }
                tone={bootstrapStatus?.dbExists ? "good" : "bad"}
              />
              <StatusCard
                icon="device"
                title="Hidro"
                value={hidroSummary}
                caption={
                  bootstrapStatus?.ivyState === "connected"
                    ? "Local Hidro service is reachable"
                    : bootstrapStatus?.ivyState === "disconnected"
                    ? "Hidro service is offline"
                    : "Checking Hidro service"
                }
                tone={ivyCardTone}
              />
              <StatusCard
                icon="recovery"
                title="Recovery"
                value={recoverySummary}
                caption={
                  recoveryAvailable
                    ? "SQLite recovery markers detected"
                    : "No recovery markers detected"
                }
                tone={recoveryCardTone}
                actions={
                  <button
                    type="button"
                    className="rounded-lg border border-amber-400/35 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-100 disabled:cursor-not-allowed disabled:opacity-45"
                    disabled={!recoveryAvailable || busyAction !== ""}
                    onClick={() => void runAction("recover", onSafeRecovery)}
                  >
                    {busyAction === "recover" ? "Recovering..." : "Recovery"}
                  </button>
                }
              />
            </div>

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                className="rounded-lg border border-amber-400/35 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-100 hover:bg-amber-500/16 disabled:cursor-not-allowed disabled:opacity-45"
                disabled={busyAction !== ""}
                onClick={() => void onShutdown?.()}
              >
                Shutdown
              </button>
            </div>

            <div className="mt-3 text-[11px] text-[var(--app-muted)]">
              Retry backend first. Use safe recovery after interrupted shutdown or power loss.
            </div>

            {(bootstrapStatus?.lastHealthFailure || bootstrapStatus?.lastExitDetail) ? (
              <div className="mt-4 rounded-lg border border-[var(--app-border)] bg-[var(--app-panel-bg)] p-3 text-xs text-[var(--app-muted)]">
                {bootstrapStatus?.lastExitDetail ? (
                  <div className="mb-2">
                    <span className="font-semibold text-[var(--app-text)]">Process:</span>{" "}
                    {bootstrapStatus.lastExitDetail}
                  </div>
                ) : null}
                {bootstrapStatus?.lastHealthFailure ? (
                  <div>
                    <span className="font-semibold text-[var(--app-text)]">Health:</span>{" "}
                    {bootstrapStatus.lastHealthFailure}
                  </div>
                ) : null}
              </div>
            ) : null}

            <details className="mt-4 rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-bg)]">
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-[var(--app-text)]">
                <span className="flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/8 text-slate-200 ring-1 ring-white/10">
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M4 19h16" />
                      <path d="M7 16V8" />
                      <path d="M12 16V5" />
                      <path d="M17 16v-3" />
                    </svg>
                  </span>
                  Diagnostics
                </span>
                <span className="text-xs text-[var(--app-muted)]">Show logs</span>
              </summary>
              <div className="px-4 pb-4">
                <div className="h-56 overflow-auto rounded-xl border border-[var(--app-border)] bg-gray-950 px-3 py-2 font-mono text-[11px] leading-5 text-green-200">
                  {bootstrapStatus?.logs?.length ? (
                    bootstrapStatus.logs.map((line, index) => (
                      <div key={`${line}-${index}`}>{line}</div>
                    ))
                  ) : (
                    <div>No startup logs yet</div>
                  )}
                </div>
              </div>
            </details>
          </div>
        </div>
      </div>
    </div>
  );
}
