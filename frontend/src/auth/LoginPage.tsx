import { useState, type FormEvent } from "react";
import type { BootstrapStatus } from "../bootstrap/floraDesktop";
import floraAppIcon from "../assets/flora-app.png";
import ThemePicker from "../components/ThemePicker";
import { getSurfaceInfo } from "../edition/config";

type Props = {
  onLogin: (username: string, password: string) => Promise<boolean> | boolean;
  loginEnabled?: boolean;
  bootstrapStatus?: BootstrapStatus;
};

type Readiness = "ready" | "checking" | "unavailable" | "not-connected";

function ReadinessRow({ label, state }: { label: string; state: Readiness }) {
  const tone = state === "ready"
    ? "bg-emerald-500"
    : state === "unavailable"
      ? "bg-rose-500"
      : "bg-amber-400";
  const value = state === "ready"
    ? "Ready"
    : state === "checking"
      ? "Checking"
      : state === "not-connected"
        ? "Not connected"
        : "Unavailable";
  return (
    <div className="flex min-h-[42px] items-center gap-[10px] rounded-lg border border-[var(--app-border)] bg-[var(--app-control-bg)] px-[12px] py-[8px]">
      <span aria-hidden="true" className={`h-[8px] w-[8px] shrink-0 rounded-full ${tone}`} />
      <span className="min-w-0 flex-1 text-[13px] font-medium text-[var(--app-text)]">{label}</span>
      <span className="text-right text-[11px] font-semibold text-[var(--app-muted)]">{value}</span>
    </div>
  );
}

export default function LoginPage({ onLogin, loginEnabled = true, bootstrapStatus }: Props) {
  const surface = getSurfaceInfo();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const isChecking = !loginEnabled && bootstrapStatus?.backendState === "starting";
  const systemState: Readiness = loginEnabled ? "ready" : isChecking ? "checking" : "unavailable";
  const dataMode = bootstrapStatus?.dataMode || "local";
  const localDataState: Readiness = dataMode === "local"
    ? isChecking ? "checking" : bootstrapStatus?.dbExists && loginEnabled ? "ready" : "unavailable"
    : "not-connected";
  const serverDataState: Readiness = dataMode === "server"
    ? isChecking ? "checking" : bootstrapStatus?.dbExists && loginEnabled ? "ready" : "unavailable"
    : "not-connected";

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!loginEnabled || isLoggingIn) return;
    setIsLoggingIn(true);
    setError("");
    try {
      const ok = await onLogin(username.trim(), password);
      if (!ok) setError("Sign-in failed. Check your username and password.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign-in failed. Please try again.");
    } finally {
      setIsLoggingIn(false);
    }
  };

  return (
    <div className="app-main app-theme-scope flex min-h-[100dvh] items-center justify-center px-[16px] py-[16px] sm:px-[24px]">
      <main className="w-full max-w-[900px]">
        <div className="overflow-hidden rounded-[20px] border border-[var(--app-border)] bg-[var(--app-panel-bg)] shadow-2xl">
          <header className="flex items-center justify-between border-b border-[var(--app-border)] px-[22px] py-[14px] sm:px-[26px]">
            <div className="flex items-center gap-[10px]">
                <span className="inline-flex h-[40px] w-[40px] items-center justify-center rounded-lg border border-[var(--app-border)] bg-[var(--app-control-bg)]">
                  <img src={floraAppIcon} alt="" className="h-[34px] w-[34px] object-contain" />
                </span>
                <div>
                  <div className="text-[17px] font-bold leading-[21px] text-[var(--app-text)]">{surface.productName}</div>
                  <div className="text-[11px] text-[var(--app-muted)]">{surface.description}</div>
                </div>
            </div>
            <ThemePicker compact loginScreen />
          </header>
          <div className="grid md:grid-cols-[minmax(0,1.6fr)_minmax(240px,0.85fr)]">
          <section className="min-w-0 p-[22px] sm:p-[26px]" aria-labelledby="login-title">

            <form onSubmit={handleSubmit} className="space-y-[12px]">
              <h1 id="login-title" className="mb-[15px] text-[18px] font-semibold leading-[24px] text-[var(--app-text)]">Sign in</h1>
              <div>
                <label htmlFor="flora-username" className="mb-[5px] block text-[12px] font-semibold text-[var(--app-text)]">Username</label>
                <input
                  id="flora-username"
                  name="username"
                  autoComplete="username"
                  value={username}
                  onChange={event => setUsername(event.target.value)}
                  disabled={!loginEnabled || isLoggingIn}
                  className="w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-control-bg)] px-[12px] py-[9px] text-[14px] leading-[20px] text-[var(--app-text)] outline-none transition focus:border-[var(--app-accent)] focus:ring-2 focus:ring-[var(--app-accent)]/20 disabled:opacity-60"
                />
              </div>
              <div>
                <label htmlFor="flora-password" className="mb-[5px] block text-[12px] font-semibold text-[var(--app-text)]">Password</label>
                <div className="relative">
                  <input
                    id="flora-password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={event => setPassword(event.target.value)}
                    disabled={!loginEnabled || isLoggingIn}
                    className="w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-control-bg)] px-[12px] py-[9px] pr-[68px] text-[14px] leading-[20px] text-[var(--app-text)] outline-none transition focus:border-[var(--app-accent)] focus:ring-2 focus:ring-[var(--app-accent)]/20 disabled:opacity-60"
                  />
                  <button type="button" onClick={() => setShowPassword(value => !value)} className="absolute inset-y-0 right-[6px] my-auto h-[30px] rounded-md px-[9px] text-[11px] font-semibold text-[var(--app-muted)] hover:text-[var(--app-text)]" aria-label={showPassword ? "Hide password" : "Show password"}>
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </div>

              {error ? <p role="alert" className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-[14px] py-[10px] text-[13px] text-rose-600 dark:text-rose-300">{error}</p> : null}

              <button
                type="submit"
                disabled={!loginEnabled || isLoggingIn || !username.trim() || !password}
                className="w-full rounded-lg bg-[var(--app-accent)] px-[14px] py-[9px] text-[13px] font-bold leading-[20px] text-[var(--app-accent-contrast)] transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-accent)] disabled:cursor-not-allowed disabled:opacity-55"
              >
                {isLoggingIn ? "Signing in…" : !loginEnabled ? `Waiting for ${surface.productName}…` : "Sign in"}
              </button>
            </form>
            <details className="mt-[14px] rounded-lg border border-[var(--app-border)] bg-[var(--app-control-bg)]/50 p-[10px] md:hidden">
              <summary className="cursor-pointer text-[12px] font-semibold text-[var(--app-text)]">
                {surface.productName} {systemState === "ready" ? "ready" : systemState === "checking" ? "checking" : "unavailable"}
              </summary>
              <div className="mt-[10px] space-y-[8px]">
                <ReadinessRow label="Local data" state={localDataState} />
                <ReadinessRow label="Server data" state={serverDataState} />
              </div>
            </details>
          </section>

          <aside className="hidden min-w-0 flex-col border-l border-[var(--app-border)] bg-[var(--app-control-bg)]/35 px-[20px] py-[26px] md:flex" aria-label="Flora readiness">
            <h2 className="mb-[15px] text-[18px] font-semibold leading-[24px] text-[var(--app-text)]">Status</h2>
            <div className="space-y-[9px]">
              <ReadinessRow label={surface.productName} state={systemState} />
              <ReadinessRow label="Local data" state={localDataState} />
              <ReadinessRow label="Server data" state={serverDataState} />
            </div>
          </aside>
          </div>
        </div>
      </main>
    </div>
  );
}
