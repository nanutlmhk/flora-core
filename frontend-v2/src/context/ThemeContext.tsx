import React, { createContext, useContext, useEffect, useState } from "react";

export type ThemeMode = "light" | "dark";
export type ThemeColor = "default" | "grey" | "green" | "oldrose" | "pink";

interface ThemeContextType {
  mode: ThemeMode;
  color: ThemeColor;
  setMode: (mode: ThemeMode) => void;
  setColor: (color: ThemeColor) => void;
  toggleMode: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem("theme-mode") as ThemeMode;
    return saved || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  });

  const [color, setColorState] = useState<ThemeColor>(() => {
    const saved = localStorage.getItem("theme-color") as ThemeColor;
    return saved || "default";
  });

  useEffect(() => {
    const root = window.document.documentElement;
    
    // Clean up
    root.classList.remove("light", "dark");
    ["default", "grey", "green", "oldrose", "pink"].forEach(c => root.classList.remove(`theme-${c}`));

    // Add classes
    root.classList.add(mode);
    root.classList.add(`theme-${color}`);

    localStorage.setItem("theme-mode", mode);
    localStorage.setItem("theme-color", color);
  }, [mode, color]);

  const setMode = (m: ThemeMode) => {
    setModeState(m);
    // Compatibility check: if color doesn't exist in the new mode, reset to default
    if (m === "dark" && (color === "oldrose" || color === "pink")) {
      setColorState("default");
    } else if (m === "light" && (color === "grey")) {
      setColorState("default");
    }
  };

  const setColor = (c: ThemeColor) => setColorState(c);

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

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within a ThemeProvider");
  return context;
}