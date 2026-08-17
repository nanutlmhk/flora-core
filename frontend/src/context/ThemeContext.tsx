import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import {
  updateOwnThemePreferences,
  type AuthThemeColor,
  type AuthThemeMode,
} from "../api/authApi";
import { getEditionInfo } from "../edition/config";

export type ThemeMode = AuthThemeMode;
export type ThemeColor = AuthThemeColor;

interface ThemeContextType {
  mode: ThemeMode;
  color: ThemeColor;
  setMode: (mode: ThemeMode) => void;
  setColor: (color: ThemeColor) => void;
  toggleMode: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

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
    const parsed = JSON.parse(raw) as { themeMode?: unknown; themeColor?: unknown };
    return {
      mode:
        parsed.themeMode === "light" || parsed.themeMode === "dark"
          ? parsed.themeMode
          : undefined,
      color:
        parsed.themeColor === "default" ||
        parsed.themeColor === "grey" ||
        parsed.themeColor === "green" ||
        parsed.themeColor === "blackpink" ||
        parsed.themeColor === "oldrose" ||
        parsed.themeColor === "pink" ||
        parsed.themeColor === "rcat" ||
        parsed.themeColor === "eforl"
          ? parsed.themeColor
          : undefined,
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

function readStoredMode(username: string): ThemeMode {
  const userTheme = readStoredUserTheme().mode as ThemeMode | undefined;
  const scoped = localStorage.getItem(getThemeStorageKey("mode", username)) as ThemeMode | null;
  const legacy = localStorage.getItem("theme-mode") as ThemeMode | null;
  return userTheme || scoped || legacy || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}

function readStoredColor(username: string): ThemeColor {
  const userTheme = readStoredUserTheme().color as ThemeColor | undefined;
  const scoped = localStorage.getItem(getThemeStorageKey("color", username)) as ThemeColor | null;
  const legacy = localStorage.getItem("theme-color") as ThemeColor | null;
  return userTheme || scoped || legacy || "default";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const edition = getEditionInfo();
  const lockedThemeColor = edition.lockedThemeColor;
  const [themeUsername, setThemeUsername] = useState(() => readThemeUsername());
  const [mode, setModeState] = useState<ThemeMode>(() => edition.defaultThemeMode || readStoredMode(readThemeUsername()));
  const [color, setColorState] = useState<ThemeColor>(() => lockedThemeColor || readStoredColor(readThemeUsername()));
  const lastSyncedPrefRef = useRef("");

  useEffect(() => {
    const syncThemeScope = () => {
      const username = readThemeUsername();
      setThemeUsername(username);
      const nextMode = readStoredMode(username);
      const nextColor = readStoredColor(username);
      setModeState(nextMode);
      setColorState(lockedThemeColor || nextColor);
    };

    syncThemeScope();
    window.addEventListener("storage", syncThemeScope);
    window.addEventListener("aidas:auth-changed", syncThemeScope as EventListener);
    return () => {
      window.removeEventListener("storage", syncThemeScope);
      window.removeEventListener("aidas:auth-changed", syncThemeScope as EventListener);
    };
  }, [lockedThemeColor]);

  useEffect(() => {
    const root = window.document.documentElement;
    
    // Clean up
    root.classList.remove("light", "dark");
    ["default", "grey", "green", "blackpink", "oldrose", "pink", "rcat", "eforl"].forEach(c => root.classList.remove(`theme-${c}`));

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
    const syncKey = `${themeUsername}|${mode}|${color}`;
    if (lastSyncedPrefRef.current === syncKey) return;
    lastSyncedPrefRef.current = syncKey;
    void updateOwnThemePreferences(mode, color)
      .then((nextUser) => {
        window.localStorage.setItem("flora_user", JSON.stringify(nextUser));
        window.dispatchEvent(new Event("aidas:auth-changed"));
      })
      .catch(() => {
        // keep local preference even if backend persistence is unavailable for the moment
      });
  }, [mode, color, themeUsername]);

  const setMode = (m: ThemeMode) => {
    setModeState(m);
    // Compatibility check: if color doesn't exist in the new mode, reset to default
    if (lockedThemeColor) {
      setColorState(lockedThemeColor);
    } else if (m === "dark" && (color === "oldrose" || color === "pink" || color === "rcat")) {
      setColorState("default");
    } else if (m === "light" && (color === "grey" || color === "blackpink")) {
      setColorState("default");
    }
  };

  const setColor = (c: ThemeColor) => {
    if (lockedThemeColor) {
      setColorState(lockedThemeColor);
      return;
    }
    setColorState(c);
  };

  const toggleMode = () => {
    const nextMode = mode === "light" ? "dark" : "light";
    setMode(nextMode);
  };

  return (
    <ThemeContext.Provider value={{ mode, color, setMode, setColor, toggleMode }}>
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
