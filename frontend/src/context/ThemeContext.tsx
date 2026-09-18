import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import {
  getPreferenceOptions,
  mergeStoredAuthUser,
  updateOwnPreferences,
  type AuthThemeColor,
  type AuthThemeMode,
  type ThemeSchemeOption,
} from "../api/authApi";
import { getSurfaceInfo } from "../edition/config";

export type ThemeMode = AuthThemeMode;
export type ThemeColor = AuthThemeColor;

interface ThemeContextType {
  mode: ThemeMode;
  color: ThemeColor;
  setColor: (color: ThemeColor) => void;
  schemes: ThemeSchemeOption[];
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);
const THEME_COLORS: ThemeColor[] = ["monochromatic", "neon", "warm", "pastel", "muji", "mori", "ocean", "pink-pastel"];
const DEFAULT_THEME: ThemeColor = "monochromatic";
const FALLBACK_SCHEMES: ThemeSchemeOption[] = [
  { code: "monochromatic", displayName: "Mono", colors: ["#121212", "#1c1c1c", "#444444", "#e0e0e0", "#b0b0b0", "#a1a1aa"] },
  { code: "neon", displayName: "Neon", colors: ["#0d0d0d", "#171717", "#444444", "#ffffff", "#b0b0b0", "#00ff85"] },
  { code: "warm", displayName: "Warm", colors: ["#1c1c1c", "#292421", "#554640", "#f5e8d8", "#c8b9a9", "#ff6f61"] },
  { code: "pastel", displayName: "Pastel", colors: ["#2c2c2c", "#383838", "#5a5a5a", "#e4e4e4", "#c5c5c5", "#a8dadc"] },
  { code: "muji", displayName: "Muji", colors: ["#f7f2e8", "#fffaf0", "#d8c8ad", "#3f3529", "#796b5c", "#8a6846"] },
  { code: "mori", displayName: "Mori", colors: ["#f1f6ef", "#fbfdf9", "#c8d8c2", "#26352a", "#667569", "#3f7652"] },
  { code: "ocean", displayName: "Ocean", colors: ["#eef5fa", "#f9fcff", "#bfd0df", "#15283a", "#5a7084", "#174f7a"] },
  { code: "pink-pastel", displayName: "Cupcake", colors: ["#fff4f7", "#ffffff", "#e7c6d2", "#362832", "#75626c", "#ad416f"] },
];

function isLightCanvas(color: string) {
  const match = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return false;
  const value = Number.parseInt(match[1], 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return (red * 299 + green * 587 + blue * 114) / 1000 > 170;
}

function isThemeColor(value: unknown): value is ThemeColor {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,47}$/.test(value);
}

function readThemeUsername() {
  if (typeof window === "undefined") return "";
  try {
    const raw = window.localStorage.getItem("flora_user");
    if (!raw) return "";
    const parsed = JSON.parse(raw) as { username?: unknown };
    return typeof parsed.username === "string" ? parsed.username.trim() : "";
  } catch {
    return "";
  }
}

function readStoredUserTheme() {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem("flora_user");
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { themeColor?: unknown };
    return {
      color: isThemeColor(parsed.themeColor) ? parsed.themeColor : undefined,
    };
  } catch {
    return {};
  }
}

function writeStoredUserTheme(mode: ThemeMode, color: ThemeColor) {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem("flora_user");
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed.username !== "string" || !parsed.username.trim()) return;
    parsed.themeMode = mode;
    parsed.themeColor = color;
    window.localStorage.setItem("flora_user", JSON.stringify(parsed));
  } catch {
    // ignore local user theme sync failures
  }
}

function getThemeStorageKey(kind: "mode" | "color", username: string) {
  const scope = username.trim().toLowerCase();
  return scope ? `theme-${kind}.${scope}` : `theme-${kind}`;
}

function readStoredColor(username: string): ThemeColor {
  const userTheme = readStoredUserTheme().color as ThemeColor | undefined;
  if (!username.trim()) return DEFAULT_THEME;
  const scoped = localStorage.getItem(getThemeStorageKey("color", username));
  return userTheme || (isThemeColor(scoped) ? scoped : undefined) || DEFAULT_THEME;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const surface = getSurfaceInfo();
  const [themeUsername, setThemeUsername] = useState(() => readThemeUsername());
  const mode: ThemeMode = "dark";
  const [color, setColorState] = useState<ThemeColor>(() => readStoredColor(readThemeUsername()));
  const [schemes, setSchemes] = useState<ThemeSchemeOption[]>(FALLBACK_SCHEMES);
  const lastSyncedPrefRef = useRef("");

  useEffect(() => {
    const syncThemeScope = () => {
      const username = readThemeUsername();
      setThemeUsername(username);
      const loginColor = username ? window.sessionStorage.getItem("flora.loginThemeColor") : null;
      const nextColor = isThemeColor(loginColor) ? loginColor : readStoredColor(username);
      if (username && loginColor) {
        window.sessionStorage.removeItem("flora.loginThemeColor");
      }
      window.sessionStorage.removeItem("flora.loginThemeMode");
      setColorState(nextColor);
    };

    syncThemeScope();
    window.addEventListener("storage", syncThemeScope);
    window.addEventListener("flora:auth-changed", syncThemeScope as EventListener);
    return () => {
      window.removeEventListener("storage", syncThemeScope);
      window.removeEventListener("flora:auth-changed", syncThemeScope as EventListener);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getPreferenceOptions().then(options => {
      if (cancelled || !options.themes.length) return;
      setSchemes(options.themes);
      setColorState(current => options.themes.some(theme => theme.code === current) ? current : options.defaultTheme);
    }).catch(() => {
      // Built-in schemes keep the login usable while the API is unavailable.
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const root = window.document.documentElement;
    
    // Clean up
    root.classList.remove("light", "dark");
    [...new Set([...THEME_COLORS, ...FALLBACK_SCHEMES.map(theme => theme.code), ...schemes.map(theme => theme.code), "esm", "nit", "default", "grey", "green", "blackpink", "oldrose", "pink", "rcat", "eforl"])].forEach(c => root.classList.remove(`theme-${c}`));

    // Add classes
    const selected = schemes.find(theme => theme.code === color) || FALLBACK_SCHEMES[0];
    const [canvas, surfaceColor, border, text, muted, accent] = selected.colors;
    const visualMode = isLightCanvas(canvas) ? "light" : mode;
    root.classList.add(visualMode);
    root.classList.add(`theme-${color}`);
    root.setAttribute("data-flora-theme", "scheme");
    root.style.setProperty("--palette-bg", canvas);
    root.style.setProperty("--palette-surface", surfaceColor);
    root.style.setProperty("--palette-border", border);
    root.style.setProperty("--palette-text", text);
    root.style.setProperty("--palette-muted", muted);
    root.style.setProperty("--palette-accent", accent);
    root.style.setProperty("--palette-secondary", border);
    root.style.setProperty("--palette-hover", accent);

    localStorage.setItem(getThemeStorageKey("mode", themeUsername), mode);
    localStorage.setItem(getThemeStorageKey("color", themeUsername), color);
    localStorage.setItem("theme-mode", mode);
    localStorage.setItem("theme-color", color);
    writeStoredUserTheme(mode, color);
  }, [mode, color, schemes, themeUsername]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!themeUsername.trim()) return;
    if (!surface.clinicalWriteEnabled) return;
    const syncKey = `${themeUsername}|${mode}|${color}`;
    if (lastSyncedPrefRef.current === syncKey) return;
    lastSyncedPrefRef.current = syncKey;
    void updateOwnPreferences({ themeMode: mode, themeColor: color })
      .then((nextUser) => {
        mergeStoredAuthUser(nextUser);
        window.dispatchEvent(new Event("flora:auth-changed"));
      })
      .catch(() => {
        // keep local preference even if backend persistence is unavailable for the moment
      });
  }, [mode, color, surface.clinicalWriteEnabled, themeUsername]);

  const setColor = (c: ThemeColor) => {
    setColorState(isThemeColor(c) && schemes.some(theme => theme.code === c) ? c : DEFAULT_THEME);
  };

  return (
    <ThemeContext.Provider value={{ mode, color, setColor, schemes }}>
      {children}
    </ThemeContext.Provider>
  );
}

// The provider and its companion hook intentionally share one module.
// eslint-disable-next-line react-refresh/only-export-components
export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within a ThemeProvider");
  return context;
}
