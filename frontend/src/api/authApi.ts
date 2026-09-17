import { BACKEND_BASE } from "./backendBase";

export type AuthThemeMode = "dark";
export type AuthThemeColor = string;
export type AuthLanguageCode = "en" | "th" | string;

export type LanguageOption = {
  code: string;
  nameEn: string;
  nameNative: string;
};

export type ThemeSchemeOption = {
  code: string;
  displayName: string;
  colors: [string, string, string, string, string, string];
};

export type LanguageMasterRow = LanguageOption & { isActive: boolean; sortOrder: number };
export type ThemeMasterRow = ThemeSchemeOption & { isActive: boolean; sortOrder: number };

export type PreferenceOptions = {
  defaultLanguage: string;
  defaultTheme: string;
  languages: LanguageOption[];
  themes: ThemeSchemeOption[];
};

export type AuthApiUser = {
  username: string;
  name: string;
  role?: string;
  themeMode?: AuthThemeMode;
  themeColor?: AuthThemeColor;
  languageCode?: AuthLanguageCode;
  staffDirectoryId?: number | null;
  parameterPreferences?: Record<string, unknown>;
  reportPreferences?: Record<string, unknown>;
  roleCodes?: string[];
  permissions?: string[];
  mustChangePassword?: boolean;
};

export type AuthRole = {
  code: string;
  displayName: string;
  description: string;
  permissions: string[];
  isActive: boolean;
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
  languageCode?: AuthLanguageCode;
  themeColor?: AuthThemeColor;
  staffDirectoryId: number | null;
  parameterPreferences: Record<string, unknown>;
  reportPreferences: Record<string, unknown>;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
  lastLoginAt: number | null;
  roleCodes: string[];
  permissions: string[];
  mustChangePassword: boolean;
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
    themeColor: typeof user.themeColor === "string" && user.themeColor.trim() ? user.themeColor.trim() : undefined,
    languageCode: typeof user.languageCode === "string" && user.languageCode.trim() ? user.languageCode.trim() : undefined,
    staffDirectoryId: Number.isFinite(Number(user.staffDirectoryId)) ? Number(user.staffDirectoryId) : null,
    parameterPreferences: user.parameterPreferences && typeof user.parameterPreferences === "object" ? user.parameterPreferences : {},
    reportPreferences: user.reportPreferences && typeof user.reportPreferences === "object" ? user.reportPreferences : {},
    roleCodes: Array.isArray(user.roleCodes) ? user.roleCodes.map(String) : [],
    permissions: Array.isArray(user.permissions) ? user.permissions.map(String) : [],
    mustChangePassword: user.mustChangePassword === true,
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

export async function getPreferenceOptions(): Promise<PreferenceOptions> {
  const res = await fetch(`${BASE}/preferences/options`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`load preference options failed (${res.status})`);
  const languages = Array.isArray(data?.languages) ? data.languages : [];
  const themes = Array.isArray(data?.themes) ? data.themes : [];
  return {
    defaultLanguage: String(data?.defaultLanguage || "en"),
    defaultTheme: String(data?.defaultTheme || "monochromatic"),
    languages: languages.map((raw: unknown) => {
      const row = (raw || {}) as Record<string, unknown>;
      return {
        code: String(row.code || ""),
        nameEn: String(row.name_en || row.nameEn || ""),
        nameNative: String(row.name_native || row.nameNative || ""),
      };
    }).filter((row: LanguageOption) => row.code),
    themes: themes.map((raw: unknown) => {
      const row = (raw || {}) as Record<string, unknown>;
      return {
        code: String(row.code || ""),
        displayName: String(row.display_name || row.displayName || row.code || ""),
        colors: [
          String(row.color_1_canvas || ""),
          String(row.color_2_surface || ""),
          String(row.color_3_border || ""),
          String(row.color_4_text || ""),
          String(row.color_5_muted || ""),
          String(row.color_6_accent || ""),
        ] as ThemeSchemeOption["colors"],
      };
    }).filter((row: ThemeSchemeOption) => row.code && row.colors.every(Boolean)),
  };
}

function parseLanguageMaster(row: Record<string, unknown>): LanguageMasterRow {
  return {
    code: String(row.code || ""),
    nameEn: String(row.name_en || row.nameEn || ""),
    nameNative: String(row.name_native || row.nameNative || ""),
    isActive: row.is_active === true || Number(row.is_active ?? row.isActive ?? 0) === 1,
    sortOrder: Number(row.sort_order ?? row.sortOrder ?? 0),
  };
}

function parseThemeMaster(row: Record<string, unknown>): ThemeMasterRow {
  return {
    code: String(row.code || ""),
    displayName: String(row.display_name || row.displayName || row.code || ""),
    colors: [1, 2, 3, 4, 5, 6].map(index => String(row[`color_${index}_${["canvas", "surface", "border", "text", "muted", "accent"][index - 1]}`] || "")) as ThemeSchemeOption["colors"],
    isActive: row.is_active === true || Number(row.is_active ?? row.isActive ?? 0) === 1,
    sortOrder: Number(row.sort_order ?? row.sortOrder ?? 0),
  };
}

export async function getPreferenceMasters(): Promise<{ languages: LanguageMasterRow[]; themes: ThemeMasterRow[] }> {
  const response = await fetch(`${BASE}/preferences/master`, { headers: buildAuthHeaders() });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || "Unable to load appearance masters");
  return {
    languages: (Array.isArray(data.languages) ? data.languages : []).map((row: Record<string, unknown>) => parseLanguageMaster(row)),
    themes: (Array.isArray(data.themes) ? data.themes : []).map((row: Record<string, unknown>) => parseThemeMaster(row)),
  };
}

export async function updateLanguageMaster(row: LanguageMasterRow): Promise<LanguageMasterRow> {
  const response = await fetch(`${BASE}/preferences/languages/${encodeURIComponent(row.code)}`, {
    method: "PUT", headers: buildAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ name_en: row.nameEn, name_native: row.nameNative, is_active: row.isActive, sort_order: row.sortOrder }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || "Unable to save language");
  return parseLanguageMaster(data.row || {});
}

export async function createLanguageMaster(row: LanguageMasterRow): Promise<LanguageMasterRow> {
  const response = await fetch(`${BASE}/preferences/languages`, {
    method: "POST", headers: buildAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ code: row.code, name_en: row.nameEn, name_native: row.nameNative, is_active: row.isActive, sort_order: row.sortOrder }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || "Unable to add language");
  return parseLanguageMaster(data.row || {});
}

export async function deleteLanguageMaster(code: string): Promise<void> {
  const response = await fetch(`${BASE}/preferences/languages/${encodeURIComponent(code)}`, { method: "DELETE", headers: buildAuthHeaders() });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || "Unable to remove language");
}

export async function getLanguageTranslations(code: string): Promise<Record<string, string>> {
  const response = await fetch(`${BASE}/preferences/translations/${encodeURIComponent(code)}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || "Unable to load translations");
  return data.values && typeof data.values === "object" ? data.values as Record<string, string> : {};
}

export async function updateLanguageTranslations(code: string, values: Record<string, string>): Promise<Record<string, string>> {
  const response = await fetch(`${BASE}/preferences/translations/${encodeURIComponent(code)}`, {
    method: "PUT", headers: buildAuthHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ values }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || "Unable to save translations");
  return data.values && typeof data.values === "object" ? data.values as Record<string, string> : {};
}

export async function updateThemeMaster(row: ThemeMasterRow): Promise<ThemeMasterRow> {
  const response = await fetch(`${BASE}/preferences/themes/${encodeURIComponent(row.code)}`, {
    method: "PUT", headers: buildAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ display_name: row.displayName, colors: row.colors, is_active: row.isActive, sort_order: row.sortOrder }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || "Unable to save scheme");
  return parseThemeMaster(data.row || {});
}

export async function createThemeMaster(row: ThemeMasterRow): Promise<ThemeMasterRow> {
  const response = await fetch(`${BASE}/preferences/themes`, {
    method: "POST", headers: buildAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ code: row.code, display_name: row.displayName, colors: row.colors, is_active: row.isActive, sort_order: row.sortOrder }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || "Unable to add scheme");
  return parseThemeMaster(data.row || {});
}

export async function deleteThemeMaster(code: string): Promise<void> {
  const response = await fetch(`${BASE}/preferences/themes/${encodeURIComponent(code)}`, { method: "DELETE", headers: buildAuthHeaders() });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || "Unable to remove scheme");
}

export function mergeStoredAuthUser(nextUser: AuthApiUser) {
  if (typeof window === "undefined") return;
  try {
    const currentRaw = window.localStorage.getItem("flora_user");
    const current = currentRaw ? JSON.parse(currentRaw) as Record<string, unknown> : {};
    window.localStorage.setItem("flora_user", JSON.stringify({ ...current, ...nextUser }));
  } catch {
    window.localStorage.setItem("flora_user", JSON.stringify(nextUser));
  }
}

export async function updateOwnPreferences(preferences: {
  name?: string;
  themeMode?: AuthThemeMode;
  themeColor?: AuthThemeColor;
  languageCode?: AuthLanguageCode;
  parameterPreferences?: Record<string, unknown>;
  reportPreferences?: Record<string, unknown>;
}): Promise<AuthApiUser> {
  const res = await fetch(`${BASE}/self/preferences`, {
    method: "PUT",
    headers: buildAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      ...(preferences.name !== undefined ? { name: preferences.name } : {}),
      ...(preferences.themeMode ? { theme_mode: preferences.themeMode } : {}),
      ...(preferences.themeColor ? { theme_color: preferences.themeColor } : {}),
      ...(preferences.languageCode ? { language_code: preferences.languageCode } : {}),
      ...(preferences.parameterPreferences !== undefined ? { parameter_preferences: preferences.parameterPreferences } : {}),
      ...(preferences.reportPreferences !== undefined ? { report_preferences: preferences.reportPreferences } : {}),
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
    languageCode: typeof raw.languageCode === "string"
      ? raw.languageCode.trim() || undefined
      : typeof raw.language_code === "string"
        ? raw.language_code.trim() || undefined
        : undefined,
    themeColor: typeof raw.themeColor === "string"
      ? raw.themeColor.trim() || undefined
      : typeof raw.theme_color === "string"
        ? raw.theme_color.trim() || undefined
        : undefined,
    staffDirectoryId: Number.isFinite(Number(raw.staffDirectoryId ?? raw.staff_directory_id))
      ? Number(raw.staffDirectoryId ?? raw.staff_directory_id)
      : null,
    parameterPreferences: raw.parameterPreferences && typeof raw.parameterPreferences === "object"
      ? raw.parameterPreferences as Record<string, unknown>
      : raw.parameter_preferences && typeof raw.parameter_preferences === "object"
        ? raw.parameter_preferences as Record<string, unknown>
        : {},
    reportPreferences: raw.reportPreferences && typeof raw.reportPreferences === "object"
      ? raw.reportPreferences as Record<string, unknown>
      : raw.report_preferences && typeof raw.report_preferences === "object"
        ? raw.report_preferences as Record<string, unknown>
        : {},
    isActive: raw.isActive === true || Number(raw.is_active || 0) === 1,
    createdAt: Number(raw.createdAt || raw.created_at || 0),
    updatedAt: Number(raw.updatedAt || raw.updated_at || 0),
    lastLoginAt:
      raw.lastLoginAt == null && raw.last_login_at == null
        ? null
        : Number(raw.lastLoginAt ?? raw.last_login_at ?? 0),
    roleCodes: (Array.isArray(raw.roleCodes) ? raw.roleCodes : Array.isArray(raw.role_codes) ? raw.role_codes : []).map(String),
    permissions: Array.isArray(raw.permissions) ? raw.permissions.map(String) : [],
    mustChangePassword: raw.mustChangePassword === true || Number(raw.must_change_password || 0) === 1,
  };
}

export async function getAuthRoles(): Promise<AuthRole[]> {
  const res = await fetch(`${BASE}/roles`, { headers: buildAuthHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.detail || data?.error || `load roles failed (${res.status})`);
  return (Array.isArray(data?.rows) ? data.rows : []).map((raw: Record<string, unknown>) => ({
    code: String(raw.code || ""),
    displayName: String(raw.display_name || raw.displayName || raw.code || ""),
    description: String(raw.description || ""),
    permissions: Array.isArray(raw.permissions) ? raw.permissions.map(String) : [],
    isActive: raw.is_active === true || Number(raw.is_active ?? raw.isActive ?? 0) === 1,
  })).filter((role: AuthRole) => role.code);
}

export async function createManagedUser(input: {
  username: string;
  name: string;
  password: string;
  hospitalId?: string;
  staffDirectoryId?: number | null;
  roleCodes: string[];
  languageCode?: string;
  themeColor?: string;
  isActive?: boolean;
}): Promise<ManagedAuthUser> {
  const res = await fetch(`${BASE}/users`, {
    method: "POST",
    headers: buildAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      username: input.username,
      name: input.name,
      password: input.password,
      hospital_id: input.hospitalId || null,
      staff_directory_id: input.staffDirectoryId ?? null,
      role_codes: input.roleCodes,
      language_code: input.languageCode || "en",
      theme_color: input.themeColor || null,
      is_active: input.isActive !== false,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.detail || data?.error || `create user failed (${res.status})`);
  return parseManagedUser(data.row || {});
}

export async function updateManagedUserAccess(userId: number, roleCodes: string[]): Promise<ManagedAuthUser> {
  const res = await fetch(`${BASE}/users/${userId}/access`, {
    method: "PUT",
    headers: buildAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ role_codes: roleCodes }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.detail || data?.error || `update access failed (${res.status})`);
  return parseManagedUser(data.row || {});
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

export async function linkManagedUserStaff(userId: number, staffDirectoryId: number | null): Promise<ManagedAuthUser> {
  const res = await fetch(`${BASE}/users/${userId}/staff-link`, {
    method: "PUT",
    headers: buildAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ staff_directory_id: staffDirectoryId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || data?.detail || `link staff failed (${res.status})`);
  if (!data?.row) throw new Error("link staff failed");
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
