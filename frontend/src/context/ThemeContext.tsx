import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import {
  updateOwnThemePreferences,
  type AuthThemeColor,
  type AuthThemeMode,
} from "../api/authApi";
import { getSurfaceInfo } from "../edition/config";

export type ThemeMode = AuthThemeMode;
export type ThemeColor = AuthThemeColor;

interface ThemeContextType {
  mode: ThemeMode;
  color: ThemeColor;
  setColor: (color: ThemeColor) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);
const THEME_COLORS: ThemeColor[] = ["monochromatic", "neon", "warm", "pastel", "jewel", "vibrant"];
const DEFAULT_THEME: ThemeColor = "monochromatic";

function isThemeColor(value: unknown): value is ThemeColor {
  return typeof value === "string" && THEME_COLORS.includes(value as ThemeColor);
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
  const scoped = localStorage.getItem(getThemeStorageKey("color", username));
  const legacy = localStorage.getItem("theme-color");
  return userTheme || (isThemeColor(scoped) ? scoped : undefined) || (isThemeColor(legacy) ? legacy : DEFAULT_THEME);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const surface = getSurfaceInfo();
  const [themeUsername, setThemeUsername] = useState(() => readThemeUsername());
  const mode: ThemeMode = "dark";
  const [color, setColorState] = useState<ThemeColor>(() => readStoredColor(readThemeUsername()));
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
    const root = window.document.documentElement;
    
    // Clean up
    root.classList.remove("light", "dark");
    [...THEME_COLORS, "esm", "nit", "default", "grey", "green", "blackpink", "oldrose", "pink", "rcat", "eforl"].forEach(c => root.classList.remove(`theme-${c}`));

    // Add classes
    root.classList.add(mode);
    root.classList.add(`theme-${color}`);

    localStorage.setItem(getThemeStorageKey("mode", themeUsername), mode);
    localStorage.setItem(getThemeStorageKey("color", themeUsername), color);
    localStorage.setItem("theme-mode", mode);
    localStorage.setItem("theme-color", color);
    writeStoredUserTheme(mode, color);
  }, [mode, color, themeUsername]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!themeUsername.trim()) return;
    if (!surface.clinicalWriteEnabled) return;
    const syncKey = `${themeUsername}|${mode}|${color}`;
    if (lastSyncedPrefRef.current === syncKey) return;
    lastSyncedPrefRef.current = syncKey;
    void updateOwnThemePreferences(mode, color)
      .then((nextUser) => {
        window.localStorage.setItem("flora_user", JSON.stringify(nextUser));
        window.dispatchEvent(new Event("flora:auth-changed"));
      })
      .catch(() => {
        // keep local preference even if backend persistence is unavailable for the moment
      });
  }, [mode, color, surface.clinicalWriteEnabled, themeUsername]);

  const setColor = (c: ThemeColor) => {
    setColorState(isThemeColor(c) ? c : DEFAULT_THEME);
  };

  return (
    <ThemeContext.Provider value={{ mode, color, setColor }}>
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
