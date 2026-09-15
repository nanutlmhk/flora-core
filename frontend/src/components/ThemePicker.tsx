import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTheme, type ThemeColor } from "../context/ThemeContext";

type Props = { compact?: boolean; loginScreen?: boolean };

export default function ThemePicker({ compact = false, loginScreen = false }: Props) {
  const { color, setColor } = useTheme();
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 8 });
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const options: Array<{ color: ThemeColor; label: string; swatches: [string, string, string] }> = [
    { color: "monochromatic", label: "Mono", swatches: ["#121212", "#888888", "#E0E0E0"] },
    { color: "neon", label: "Neon", swatches: ["#0D0D0D", "#00FF85", "#1E90FF"] },
    { color: "warm", label: "Warm", swatches: ["#1C1C1C", "#FF6F61", "#DAA520"] },
    { color: "pastel", label: "Pastel", swatches: ["#2C2C2C", "#A8DADC", "#FFC1CC"] },
    { color: "jewel", label: "Jewel", swatches: ["#1A1A1A", "#004D61", "#822659"] },
    { color: "vibrant", label: "Vibrant", swatches: ["#181818", "#FF5722", "#673AB7"] },
  ];
  const current = options.find(option => option.color === color);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const placeMenu = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const estimatedMenuHeight = 238;
      const below = rect.bottom + 8;
      const top = below + estimatedMenuHeight <= window.innerHeight - 8
        ? below
        : Math.max(8, rect.top - estimatedMenuHeight - 8);
      setMenuPosition({
        top,
        right: Math.max(8, window.innerWidth - rect.right),
      });
    };
    placeMenu();
    window.addEventListener("resize", placeMenu);
    window.addEventListener("scroll", placeMenu, true);
    return () => {
      window.removeEventListener("resize", placeMenu);
      window.removeEventListener("scroll", placeMenu, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-label={`Theme: ${current?.label || "Select theme"}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-control-bg)] text-[var(--app-text)] transition hover:border-[var(--app-accent)] ${loginScreen ? "h-[40px] w-[40px]" : compact ? "h-8 w-9" : "min-h-10 px-3 text-xs font-semibold"}`}
        title={current?.label || "Select theme"}
      >
        <svg viewBox="0 0 24 24" className={loginScreen ? "h-[18px] w-[18px] shrink-0" : "h-4 w-4 shrink-0"} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M12 3a9 9 0 1 0 9 9c0-1.1-.9-2-2-2h-1.5a2 2 0 0 1-2-2V6a3 3 0 0 0-3-3Z" />
          <circle cx="7.5" cy="11" r=".8" fill="currentColor" />
          <circle cx="10" cy="6.8" r=".8" fill="currentColor" />
          <circle cx="7.8" cy="16" r=".8" fill="currentColor" />
        </svg>
        {!compact ? <span>{current?.label || "Theme"}</span> : null}
        {!compact ? <span aria-hidden="true">⌄</span> : null}
      </button>
      {open ? createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label="Choose Flora theme"
          className="fixed z-[10000] w-[180px] max-w-[calc(100vw-16px)] rounded-xl border border-[var(--app-border)] bg-[var(--app-panel-bg)] p-[6px] shadow-2xl"
          style={{ top: menuPosition.top, right: menuPosition.right }}
        >
          {options.map(option => {
            const selected = option.color === color;
            return (
              <button
                key={option.color}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => {
                  if (loginScreen) {
                    window.sessionStorage.setItem("flora.loginThemeColor", option.color);
                  }
                  setColor(option.color);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-[9px] rounded-lg px-[9px] py-[7px] text-left text-[12px] text-[var(--app-text)] hover:bg-[var(--app-control-bg)] ${selected ? "bg-[var(--app-control-bg)] font-bold" : ""}`}
              >
                <span className="flex h-[20px] w-[34px] shrink-0 overflow-hidden rounded border border-[var(--app-border)]" aria-hidden="true">
                  {option.swatches.map(swatch => <span key={swatch} className="h-full flex-1" style={{ backgroundColor: swatch }} />)}
                </span>
                <span className="flex-1">{option.label}</span>
                {selected ? <span aria-hidden="true" className="text-[var(--app-accent)]">✓</span> : null}
              </button>
            );
          })}
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
