import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Position = { left: number; top: number; width: number };

export default function ClinicalReferenceTooltip({
  text,
  className = "",
  helpCursor = false,
  disabled = false,
  compact = false,
  children,
}: {
  text: string;
  className?: string;
  helpCursor?: boolean;
  disabled?: boolean;
  compact?: boolean;
  children: ReactNode;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<Position>({ left: 8, top: 8, width: 280 });

  const place = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor || typeof window === "undefined") return;
    const rect = anchor.getBoundingClientRect();
    const margin = 10;
    const longestLine = text.split("\n").reduce((longest, line) => Math.max(longest, line.length), 0);
    const preferredWidth = compact ? Math.max(72, Math.min(220, longestLine * 7 + 28)) : 320;
    const minimumWidth = compact ? 72 : 220;
    const width = Math.min(preferredWidth, Math.max(minimumWidth, window.innerWidth - margin * 2));
    let left = rect.right + margin;
    if (left + width > window.innerWidth - margin) left = rect.left - width - margin;
    left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
    setPosition(current => ({ ...current, left, width, top: Math.max(margin, rect.top) }));
  }, [compact, text]);

  useEffect(() => {
    if (!open) return;
    place();
    const update = () => place();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, place]);

  useLayoutEffect(() => {
    if (!open || !tooltipRef.current || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const tooltipHeight = tooltipRef.current.offsetHeight;
    const desiredTop = rect.top + rect.height / 2 - tooltipHeight / 2;
    const top = Math.max(10, Math.min(desiredTop, window.innerHeight - tooltipHeight - 10));
    setPosition(current => current.top === top ? current : { ...current, top });
  }, [open, text, position.left, position.width]);

  return <>
    <div
      ref={anchorRef}
      tabIndex={!disabled && helpCursor ? 0 : undefined}
      className={`${helpCursor ? "cursor-help select-none" : ""} focus:outline-none ${className}`}
      onPointerEnter={() => { if (!disabled) setOpen(true); }}
      onPointerLeave={() => setOpen(false)}
      onFocus={() => { if (!disabled) setOpen(true); }}
      onBlur={() => setOpen(false)}
      aria-describedby={open ? "clinical-reference-tooltip" : undefined}
    >
      {children}
    </div>
    {open && !disabled && typeof document !== "undefined" ? createPortal(
      <div
        ref={tooltipRef}
        id="clinical-reference-tooltip"
        role="tooltip"
        className={`clinical-reference-tooltip${compact ? " clinical-reference-tooltip--compact" : ""}`}
        style={{ left: position.left, top: position.top, width: position.width }}
      >
        {text}
      </div>,
      document.body,
    ) : null}
  </>;
}
