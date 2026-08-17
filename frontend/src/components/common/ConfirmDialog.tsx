import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

type ConfirmTone = "danger" | "primary";

type Props = {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  busy?: boolean;
  children?: ReactNode;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
};

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  busy = false,
  children,
  onConfirm,
  onCancel,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onCancel, open]);

  if (!open || typeof document === "undefined") return null;

  const confirmClass =
    tone === "danger"
      ? "bg-red-600 hover:bg-red-700 text-white disabled:bg-red-400"
      : "hover:brightness-95 disabled:opacity-70";

  return createPortal(
    <div className="app-theme-scope fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-lg border border-[var(--app-border)] bg-[var(--app-panel-bg)] shadow-lg backdrop-blur">
        <div className="px-4 py-3 border-b border-[var(--app-border)]">
          <div className="text-sm font-semibold text-[var(--app-text)]">
            {title}
          </div>
        </div>
        {message ? (
          <div className="px-4 py-3 text-sm text-[var(--app-muted)] whitespace-pre-wrap">
            {message}
          </div>
        ) : null}
        {children ? <div className="px-4 pb-3">{children}</div> : null}
        <div className="px-4 py-3 border-t border-[var(--app-border)] flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded border border-[var(--app-control-border)] px-3 py-1.5 text-sm text-[var(--app-text)] bg-[var(--app-button-neutral-bg)] hover:bg-[var(--app-button-neutral-hover)] disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => void onConfirm()}
            disabled={busy}
            className={`rounded px-3 py-1.5 text-sm ${confirmClass}`}
            style={
              tone === "primary"
                ? {
                    background: "var(--app-accent)",
                    color: "var(--app-accent-contrast)",
                  }
                : undefined
            }
          >
            {busy ? "Processing..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
