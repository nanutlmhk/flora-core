import { BACKEND_BASE } from "./backendBase";

export type AuthThemeMode = "dark";
export type AuthThemeColor =
  | "monochromatic"
  | "neon"
  | "warm"
  | "pastel"
  | "jewel"
  | "vibrant";

export type AuthApiUser = {
  username: string;
  name: string;
  role?: string;
  themeMode?: AuthThemeMode;
  themeColor?: AuthThemeColor;
};

export type AuthLoginResult = {
  user: AuthApiUser;
  sessionToken: string;
  expiresAt?: number;
};

export type ManagedAuthUser = {
  id: number;
  username: string;
  name: string;
  role?: string;
  hospitalId?: string;
  authSource?: string;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
  lastLoginAt: number | null;
};

const BASE = `${BACKEND_BASE}/api/auth`;
const SESSION_TOKEN_KEY = "flora_auth_token";

export function readStoredAuthToken(): string {
  if (typeof window === "undefined") return "";
  return String(window.localStorage.getItem(SESSION_TOKEN_KEY) || "").trim();
}

export function writeStoredAuthToken(token: string) {
  if (typeof window === "undefined") return;
  const normalized = String(token || "").trim();
  if (!normalized) {
    window.localStorage.removeItem(SESSION_TOKEN_KEY);
    return;
  }
  window.localStorage.setItem(SESSION_TOKEN_KEY, normalized);
}

export function clearStoredAuthToken() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(SESSION_TOKEN_KEY);
}

function buildAuthHeaders(extra: Record<string, string> = {}) {
  const token = readStoredAuthToken();
  return {
    ...extra,
    ...(token ? { "X-FLORA-Session": token } : {}),
  };
}

function parseAuthUser(user: Partial<AuthApiUser> | undefined): AuthApiUser {
  if (!user || typeof user.username !== "string" || !user.username.trim()) {
    throw new Error("auth response missing user");
  }
  return {
    username: user.username.trim(),
    name: typeof user.name === "string" && user.name.trim() ? user.name.trim() : user.username.trim(),
    role: typeof user.role === "string" && user.role.trim() ? user.role.trim() : undefined,
    themeMode: user.themeMode === "dark" ? "dark" : undefined,
    themeColor:
      user.themeColor === "monochromatic" ||
      user.themeColor === "neon" ||
      user.themeColor === "warm" ||
      user.themeColor === "pastel" ||
      user.themeColor === "jewel" ||
      user.themeColor === "vibrant"
        ? user.themeColor
        : undefined,
  };
}

export async function loginWithPassword(username: string, password: string): Promise<AuthLoginResult> {
  const res = await fetch(`${BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      data && typeof data.error === "string"
        ? data.error
        : `login failed (${res.status})`;
    throw new Error(message);
  }

  const user = data?.user as Partial<AuthApiUser> | undefined;
  const sessionToken = typeof data?.session_token === "string" ? data.session_token.trim() : "";
  if (!sessionToken) {
    throw new Error("login response missing session");
  }

  return {
    user: parseAuthUser(user),
    sessionToken,
    expiresAt: Number.isFinite(Number(data?.expires_at)) ? Number(data.expires_at) : undefined,
  };
}

export async function whoAmI(): Promise<AuthApiUser> {
  const res = await fetch(`${BASE}/whoami`, {
    headers: buildAuthHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      data && typeof data.error === "string"
        ? data.error
        : `whoami failed (${res.status})`;
    throw new Error(message);
  }
  const user = data?.user as Partial<AuthApiUser> | undefined;
  return parseAuthUser(user);
}

export async function logoutAuthSession(): Promise<void> {
  const res = await fetch(`${BASE}/logout`, {
    method: "POST",
    headers: buildAuthHeaders(),
  });
  if (!res.ok && res.status !== 401) {
    const data = await res.json().catch(() => ({}));
    const message =
      data && typeof data.error === "string"
        ? data.error
        : `logout failed (${res.status})`;
    throw new Error(message);
  }
}

export async function updateOwnThemePreferences(
  themeMode: AuthThemeMode,
  themeColor: AuthThemeColor,
): Promise<AuthApiUser> {
  const res = await fetch(`${BASE}/self/preferences`, {
    method: "PUT",
    headers: buildAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      theme_mode: themeMode,
      theme_color: themeColor,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      data && typeof data.error === "string"
        ? data.error
        : `update preferences failed (${res.status})`;
    throw new Error(message);
  }
  return parseAuthUser(data?.user as Partial<AuthApiUser> | undefined);
}

function parseManagedUser(raw: Record<string, unknown>): ManagedAuthUser {
  return {
    id: Number(raw.id || 0),
    username: String(raw.username || "").trim(),
    name: String(raw.name || raw.username || "").trim(),
    role: typeof raw.role === "string" && raw.role.trim() ? raw.role.trim() : undefined,
    hospitalId: typeof raw.hospitalId === "string"
      ? raw.hospitalId.trim() || undefined
      : typeof raw.hospital_id === "string"
      ? raw.hospital_id.trim() || undefined
      : undefined,
    authSource: typeof raw.authSource === "string"
      ? raw.authSource.trim() || undefined
      : typeof raw.auth_source === "string"
      ? raw.auth_source.trim() || undefined
      : undefined,
    isActive: raw.isActive === true || Number(raw.is_active || 0) === 1,
    createdAt: Number(raw.createdAt || raw.created_at || 0),
    updatedAt: Number(raw.updatedAt || raw.updated_at || 0),
    lastLoginAt:
      raw.lastLoginAt == null && raw.last_login_at == null
        ? null
        : Number(raw.lastLoginAt ?? raw.last_login_at ?? 0),
  };
}

export async function getManagedUsers(opts: {
  q?: string;
  includeInactive?: boolean;
} = {}): Promise<ManagedAuthUser[]> {
  const params = new URLSearchParams();
  if (opts.q) params.set("q", opts.q);
  if (opts.includeInactive === false) params.set("include_inactive", "false");

  const suffix = params.toString() ? `?${params.toString()}` : "";
  const res = await fetch(`${BASE}/users${suffix}`, {
    headers: buildAuthHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      data && typeof data.error === "string"
        ? data.error
        : `load users failed (${res.status})`;
    throw new Error(message);
  }

  const rows = Array.isArray(data?.rows) ? data.rows : [];
  return rows
    .map((row: unknown) => parseManagedUser((row || {}) as Record<string, unknown>))
    .filter((row: ManagedAuthUser) => row.id > 0 && row.username);
}

export async function getSelfManagedUser(username: string): Promise<ManagedAuthUser> {
  void username;
  const res = await fetch(`${BASE}/self`, {
    headers: buildAuthHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      data && typeof data.error === "string"
        ? data.error
        : `load account failed (${res.status})`;
    throw new Error(message);
  }
  if (!data?.row) throw new Error("load account failed");
  return parseManagedUser(data.row as Record<string, unknown>);
}

export async function setManagedUserActive(userId: number, isActive: boolean): Promise<ManagedAuthUser> {
  const res = await fetch(`${BASE}/users/${userId}/active`, {
    method: "PUT",
    headers: buildAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ is_active: isActive }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      data && typeof data.error === "string"
        ? data.error
        : `update user failed (${res.status})`;
    throw new Error(message);
  }
  if (!data?.row) throw new Error("update user failed");
  return parseManagedUser(data.row as Record<string, unknown>);
}

export async function resetManagedUserPassword(
  userId: number,
  password?: string,
): Promise<{ row: ManagedAuthUser; appliedPassword: string }> {
  const res = await fetch(`${BASE}/users/${userId}/reset-password`, {
    method: "POST",
    headers: buildAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(password ? { password } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      data && typeof data.error === "string"
        ? data.error
        : `reset password failed (${res.status})`;
    throw new Error(message);
  }
  if (!data?.row) throw new Error("reset password failed");
  return {
    row: parseManagedUser(data.row as Record<string, unknown>),
    appliedPassword: String(data.applied_password || "").trim(),
  };
}

export async function changeOwnPassword(
  username: string,
  currentPassword: string,
  newPassword: string,
): Promise<ManagedAuthUser> {
  void username;
  const res = await fetch(`${BASE}/self/change-password`, {
    method: "POST",
    headers: buildAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      data && typeof data.error === "string"
        ? data.error
        : `change password failed (${res.status})`;
    throw new Error(message);
  }
  if (!data?.row) throw new Error("change password failed");
  return parseManagedUser(data.row as Record<string, unknown>);
}
