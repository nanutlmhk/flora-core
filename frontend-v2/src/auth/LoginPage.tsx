import { useState } from "react";

type Props = {
  onLogin: (username: string, password: string) => boolean;
};

export default function LoginPage({ onLogin }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const ok = onLogin(username, password);
    if (!ok) {
      setError("Invalid username or password");
      return;
    }
    setError("");
  };

  return (
    <div className="h-screen flex items-center justify-center p-4 app-main app-theme-scope">
      <div className="w-full max-w-sm rounded-xl border border-[var(--app-border)] bg-[var(--app-panel-bg)] p-6 shadow-xl backdrop-blur">
        <div className="mb-5">
          <div className="text-xl font-semibold text-[var(--app-text)]">
            Aidas
          </div>
          <div className="text-xs text-[var(--app-muted)]">
            Sign in to continue
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
              className="w-full rounded border border-[var(--app-border)] bg-white/90 dark:bg-gray-950/70 px-3 py-2 text-sm text-[var(--app-text)] focus:outline-none focus:ring-2 focus:ring-blue-500/60"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoComplete="username"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-[var(--app-muted)]">
              Password
            </label>
            <input
              type="password"
              className="w-full rounded border border-[var(--app-border)] bg-white/90 dark:bg-gray-950/70 px-3 py-2 text-sm text-[var(--app-text)] focus:outline-none focus:ring-2 focus:ring-blue-500/60"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            className="w-full rounded bg-[var(--app-accent)] px-3 py-2 text-sm font-medium text-[var(--app-accent-contrast)] hover:brightness-95"
          >
            Sign In
          </button>
        </form>

        <div className="mt-4 text-xs text-[var(--app-muted)]">
          Demo: `doctor / doctor`, `nurse / nurse`
        </div>
      </div>
    </div>
  );
}
