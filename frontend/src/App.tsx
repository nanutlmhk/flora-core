import { useCallback, useEffect, useRef, useState } from "react";
import TopBar from "./layout/TopBar";
import LeftRail from "./layout/LeftRail";
import MainArea from "./layout/MainArea";
import RightRail from "./layout/RightRail";
import { getCaseStatus } from "./api/caseApi";
import type { CaseStatus } from "./api/caseApi";
import LoginPage from "./auth/LoginPage";
import { useAuth } from "./auth/useAuth";
import { useBootstrapStatus } from "./bootstrap/useBootstrapStatus";
import { getEditionInfo } from "./edition/config";

const LEFT_RAIL_COLLAPSED_KEY = "flora.ui.leftRailCollapsed";
const RIGHT_RAIL_COLLAPSED_KEY = "flora.ui.rightRailCollapsed";

function readStoredBool(key: string, fallback: boolean) {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  if (raw == null) return fallback;
  return raw === "1";
}

export default function App() {
  const { user, ready, isAuthenticated, login, logout, syncSession } = useAuth();
  const bootstrap = useBootstrapStatus();
  const edition = getEditionInfo();
  const [caseStatus, setCaseStatus] = useState<CaseStatus>({ status: "IDLE" });
  const [isHistoryMode, setIsHistoryMode] = useState(false);
  const [isLeftRailOpen, setIsLeftRailOpen] = useState(false);
  const [isRightRailOpen, setIsRightRailOpen] = useState(false);
  const [isLeftRailCollapsed, setIsLeftRailCollapsed] = useState(() =>
    readStoredBool(LEFT_RAIL_COLLAPSED_KEY, false),
  );
  const [isRightRailCollapsed, setIsRightRailCollapsed] = useState(() =>
    readStoredBool(RIGHT_RAIL_COLLAPSED_KEY, false),
  );
  const [activeView, setActiveView] = useState<
    | "case"
    | "form"
    | "diagnosis"
    | "staff"
    | "drug"
    | "patient"
    | "report"
    | "master"
    | "history"
  >("case");
  const [shutdownPrompt, setShutdownPrompt] = useState<{
    open: boolean;
    stage: "confirm" | "closing";
    backend: string;
    database: string;
  }>({
    open: false,
    stage: "confirm",
    backend: "Waiting",
    database: "Waiting",
  });
  const focusedRailRestoreRef = useRef<{ left: boolean; right: boolean } | null>(null);

  const refreshCase = useCallback(async () => {
    try {
      const next = await getCaseStatus();
      setCaseStatus(next);
      setIsHistoryMode(false);
    } catch (err) {
      console.error("Fetch failed", err);
    }
  }, []);

  const openCaseFromHistory = useCallback(
    (nextCase: Exclude<CaseStatus, { status: "IDLE" }>) => {
      setCaseStatus(nextCase);
      setIsHistoryMode(true);
      setActiveView("report");
      setIsLeftRailOpen(false);
      setIsRightRailOpen(false);
    },
    [],
  );

  const applyStartTimeUpdate = useCallback((caseId: number, startTime: number) => {
    setCaseStatus(prev => {
      if (prev.status === "IDLE") return prev;
      if (prev.case_id !== caseId) return prev;
      return { ...prev, start_time: startTime };
    });
  }, []);

  const applyDischargeTimeUpdate = useCallback((caseId: number, dischargeTime: number) => {
    setCaseStatus(prev => {
      if (prev.status === "IDLE") return prev;
      if (prev.case_id !== caseId) return prev;
      return {
        ...prev,
        status: prev.status === "ACTIVE" ? "DISCHARGED" : prev.status,
        discharge_time: dischargeTime,
      };
    });
  }, []);

  useEffect(() => {
    if (!bootstrap.status.ready) return;
    void syncSession();
    // This effect synchronizes React with the external backend bootstrap state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshCase();
  }, [bootstrap.status.ready, refreshCase, syncSession]);

  useEffect(() => {
    if (!user?.username) return;
    // A changed authenticated session resets navigation to its safe landing view.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveView("case");
    setIsHistoryMode(false);
  }, [user?.username]);

  useEffect(() => {
    if (caseStatus.status === "IDLE" && activeView === "form") {
      // Forms require a current case, so leaving the case clears this route.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveView("case");
    }
  }, [activeView, caseStatus.status]);

  // No redirect: all users can access "master" (Manage) — ManageView limits tabs by role.

  useEffect(() => {
    const onCaseHnUpdated = (event: Event) => {
      const custom = event as CustomEvent<{ caseId?: unknown; hn?: unknown }>;
      const changedCaseId = Number(custom.detail?.caseId);
      const nextHn = String(custom.detail?.hn || "").trim();
      if (!Number.isFinite(changedCaseId) || !nextHn) return;
      setCaseStatus((prev) => {
        if (prev.status === "IDLE") return prev;
        if (prev.case_id !== changedCaseId) return prev;
        return { ...prev, hn: nextHn };
      });
    };
    window.addEventListener("flora:case-hn-updated", onCaseHnUpdated);
    return () => window.removeEventListener("flora:case-hn-updated", onCaseHnUpdated);
  }, []);

  useEffect(() => {
    const needsFocusedLayout = activeView === "master" || activeView === "history";
    const needsFormLayout = activeView === "form";

    if (needsFocusedLayout) {
      if (!focusedRailRestoreRef.current) {
        focusedRailRestoreRef.current = {
          left: isLeftRailCollapsed,
          right: isRightRailCollapsed,
        };
      }
      // Focused views intentionally synchronize their surrounding rail layout.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (!isLeftRailCollapsed) setIsLeftRailCollapsed(true);
      if (!isRightRailCollapsed) setIsRightRailCollapsed(true);
      return;
    }

    if (needsFormLayout) {
      if (!focusedRailRestoreRef.current) {
        focusedRailRestoreRef.current = {
          left: isLeftRailCollapsed,
          right: isRightRailCollapsed,
        };
      }
      if (!isRightRailCollapsed) setIsRightRailCollapsed(true);
      return;
    }

    if (focusedRailRestoreRef.current) {
      const restore = focusedRailRestoreRef.current;
      focusedRailRestoreRef.current = null;
      setIsLeftRailCollapsed(restore.left);
      setIsRightRailCollapsed(restore.right);
    }
  }, [activeView, isLeftRailCollapsed, isRightRailCollapsed]);

  useEffect(() => {
    // View changes dismiss transient mobile drawers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLeftRailOpen(false);
    setIsRightRailOpen(false);
  }, [activeView]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LEFT_RAIL_COLLAPSED_KEY, isLeftRailCollapsed ? "1" : "0");
  }, [isLeftRailCollapsed]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(RIGHT_RAIL_COLLAPSED_KEY, isRightRailCollapsed ? "1" : "0");
  }, [isRightRailCollapsed]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.title = edition.productName;
  }, [edition.productName]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const role = String(user?.role || "").toLowerCase();
    const root = document.documentElement;
    if (role === "nurse" || role === "anesthetist") {
      root.setAttribute("data-role-tone", role);
      return;
    }
    root.removeAttribute("data-role-tone");
  }, [user?.role]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleWheel = (e: WheelEvent) => {
      // Check for Ctrl key (or Cmd on Mac) + Scroll
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();

        // Only works in Electron where floraDesktop is available
        const desktop = window.floraDesktop;
        if (desktop && typeof desktop.setZoomLevel === "function") {
          const currentZoom = desktop.getZoomLevel();
          const zoomStep = 0.2;

          if (e.deltaY < 0) {
            // Scroll Up -> Zoom In
            desktop.setZoomLevel(Math.min(5, currentZoom + zoomStep));
          } else {
            // Scroll Down -> Zoom Out
            desktop.setZoomLevel(Math.max(-2, currentZoom - zoomStep));
          }
        }
      }
    };

    window.addEventListener("wheel", handleWheel, { passive: false });
    return () => window.removeEventListener("wheel", handleWheel);
  }, []);

  useEffect(() => {
    const unsubscribe = window.floraDesktop?.onShutdownRequested?.(() => {
      setShutdownPrompt(prev =>
        prev.open
          ? prev
          : {
              open: true,
              stage: "confirm",
              backend: "Waiting",
              database: "Waiting",
            },
      );
    });
    return () => {
      unsubscribe?.();
    };
  }, []);

  const handleShutdown = useCallback(() => {
    setShutdownPrompt({
      open: true,
      stage: "confirm",
      backend: "Waiting",
      database: "Waiting",
    });
  }, []);

  const cancelShutdown = useCallback(() => {
    setShutdownPrompt({
      open: false,
      stage: "confirm",
      backend: "Waiting",
      database: "Waiting",
    });
  }, []);

  const confirmShutdown = useCallback(async () => {
    setShutdownPrompt({
      open: true,
      stage: "closing",
      backend: "Stopping...",
      database: "Waiting...",
    });
    window.setTimeout(() => {
      setShutdownPrompt(prev =>
        prev.open && prev.stage === "closing"
          ? { ...prev, backend: "Stopped", database: "Disconnecting..." }
          : prev,
      );
    }, 180);
    window.setTimeout(() => {
      setShutdownPrompt(prev =>
        prev.open && prev.stage === "closing"
          ? { ...prev, backend: "Stopped", database: "Disconnected" }
          : prev,
      );
    }, 360);
    try {
      await window.floraDesktop?.shutdownApp?.();
    } catch (err) {
      console.error("Shutdown unavailable", err);
      setShutdownPrompt({
        open: true,
        stage: "confirm",
        backend: "Waiting",
        database: "Waiting",
      });
    }
  }, []);

  const shutdownOverlay = shutdownPrompt.open ? (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/45 p-4">
      <div className="w-full max-w-xl rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-bg)] p-6 shadow-2xl backdrop-blur">
        <div className="flex items-start gap-4">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-400/10 text-amber-300 ring-1 ring-amber-300/30">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12 3v9" />
              <path d="M12 16h.01" />
              <path d="M10.3 4.5 3.9 16a1.3 1.3 0 0 0 1.1 2h13.9a1.3 1.3 0 0 0 1.1-2L13.7 4.5a1.3 1.3 0 0 0-2.4 0Z" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xl font-semibold text-[var(--app-text)]">Shutdown FLORA?</div>
            <div className="mt-1 text-sm text-[var(--app-muted)]">
              {shutdownPrompt.stage === "closing"
                ? "Shutting down FLORA on this workstation."
                : "Use Cancel to keep working. Choose Shutdown only when you really want to exit."}
            </div>
          </div>
        </div>

        {shutdownPrompt.stage === "closing" ? (
          <div className="mt-5 rounded-xl border border-[var(--app-border)] bg-[var(--app-control-bg)] p-4">
            <div className="text-xs uppercase tracking-[0.18em] text-[var(--app-muted)]">Shutting Down</div>
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="font-medium text-[var(--app-text)]">Backend</span>
              <span className="text-[var(--app-muted)]">{shutdownPrompt.backend}</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="font-medium text-[var(--app-text)]">Database</span>
              <span className="text-[var(--app-muted)]">{shutdownPrompt.database}</span>
            </div>
          </div>
        ) : null}

        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            className="rounded-lg border border-[var(--app-border)] px-4 py-2 text-sm"
            onClick={cancelShutdown}
            disabled={shutdownPrompt.stage === "closing"}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-lg border border-amber-400/35 bg-amber-500/10 px-4 py-2 text-sm text-amber-100 disabled:opacity-60"
            onClick={() => void confirmShutdown()}
            disabled={shutdownPrompt.stage === "closing"}
          >
            Shutdown
          </button>
        </div>
      </div>
    </div>
  ) : null;

  if (!ready) {
    return null;
  }

  if (!bootstrap.status.ready || !isAuthenticated) {
    return (
      <>
        <LoginPage
          onLogin={login}
          loginEnabled={bootstrap.status.ready}
          bootstrapStatus={bootstrap.status}
          onRetryStart={bootstrap.retryStart}
          onSafeRecovery={bootstrap.safeRecovery}
          onStopBackend={bootstrap.stopBackend}
          onShutdown={handleShutdown}
          sessionUserName={user?.name || ""}
        />
        {shutdownOverlay}
      </>
    );
  }

  return (
    <div className="app-shell app-theme-scope h-screen font-sans flex flex-col">
      <TopBar
        activeView={activeView}
        setActiveView={setActiveView}
        sessionUser={user}
        onLogout={logout}
        onShutdown={handleShutdown}
        onOpenLeftRail={() => {
          setIsRightRailOpen(false);
          setIsLeftRailOpen(true);
        }}
        onOpenRightRail={() => {
          setIsLeftRailOpen(false);
          setIsRightRailOpen(true);
        }}
      />

      <div className="flex flex-1 overflow-hidden">
        {isLeftRailCollapsed ? (
          <div className="app-rail hidden lg:flex w-9 border-r items-center justify-center">
            <button
              type="button"
              className="flex h-8 w-7 items-center justify-center rounded-r-md border border-l-0 border-[var(--app-border)] bg-[var(--app-control-bg)] text-sm font-semibold text-[var(--app-text)] shadow-sm hover:bg-[var(--app-panel-bg)]"
              title="Expand left rail"
              onClick={() => setIsLeftRailCollapsed(false)}
            >
              {">"}
            </button>
          </div>
        ) : (
          <div className="app-rail hidden lg:block w-[13.5rem] border-r relative">
            <button
              type="button"
              className="absolute -right-3 top-1/2 z-10 flex h-9 w-7 -translate-y-1/2 items-center justify-center rounded-md border border-[var(--app-border)] bg-[var(--app-control-bg)] text-sm font-semibold text-[var(--app-text)] shadow-md hover:bg-[var(--app-panel-bg)]"
              title="Collapse left rail"
              onClick={() => setIsLeftRailCollapsed(true)}
            >
              {"<"}
            </button>
            <LeftRail
              caseStatus={caseStatus}
              onCaseChange={refreshCase}
              historyMode={isHistoryMode}
              onCurrentCaseStarted={() => setActiveView("case")}
              onCaseStartTimeUpdated={applyStartTimeUpdate}
              onCaseDischargeTimeUpdated={applyDischargeTimeUpdate}
            />
          </div>
        )}

        <div className="app-main flex-1 overflow-auto">
          <MainArea
            caseStatus={caseStatus}
            activeView={activeView}
            sessionUser={user}
            onCaseDischargeTimeUpdated={applyDischargeTimeUpdate}
            onOpenCase={openCaseFromHistory}
          />
        </div>

        {isRightRailCollapsed ? (
          <div className="app-rail hidden lg:flex w-9 border-l items-center justify-center">
            <button
              type="button"
              className="flex h-8 w-7 items-center justify-center rounded-l-md border border-r-0 border-[var(--app-border)] bg-[var(--app-control-bg)] text-sm font-semibold text-[var(--app-text)] shadow-sm hover:bg-[var(--app-panel-bg)]"
              title="Expand right rail"
              onClick={() => setIsRightRailCollapsed(false)}
            >
              {"<"}
            </button>
          </div>
        ) : (
          <div className="app-rail hidden lg:block w-[14.5rem] border-l relative">
            <button
              type="button"
              className="absolute -left-3 top-1/2 z-10 flex h-9 w-7 -translate-y-1/2 items-center justify-center rounded-md border border-[var(--app-border)] bg-[var(--app-control-bg)] text-sm font-semibold text-[var(--app-text)] shadow-md hover:bg-[var(--app-panel-bg)]"
              title="Collapse right rail"
              onClick={() => setIsRightRailCollapsed(true)}
            >
              {">"}
            </button>
            <RightRail caseStatus={caseStatus} sessionUser={user} />
          </div>
        )}
      </div>

      {isLeftRailOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/45"
            aria-label="Close case panel"
            onClick={() => setIsLeftRailOpen(false)}
          />
          <div className="app-rail absolute left-0 top-0 h-full w-[88vw] max-w-[340px] border-r shadow-xl flex flex-col">
            <div className="flex items-center justify-between border-b border-[var(--app-border)] px-3 py-2">
              <div className="text-xs font-semibold">Case Panel</div>
              <button
                type="button"
                className="rounded border border-[var(--app-border)] px-2 py-1 text-xs"
                onClick={() => setIsLeftRailOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <LeftRail
                caseStatus={caseStatus}
                onCaseChange={refreshCase}
                historyMode={isHistoryMode}
                onCurrentCaseStarted={() => setActiveView("case")}
                onCaseStartTimeUpdated={applyStartTimeUpdate}
                onCaseDischargeTimeUpdated={applyDischargeTimeUpdate}
              />
            </div>
          </div>
        </div>
      ) : null}

      {isRightRailOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/45"
            aria-label="Close timeline panel"
            onClick={() => setIsRightRailOpen(false)}
          />
          <div className="app-rail absolute right-0 top-0 h-full w-[88vw] max-w-[360px] border-l shadow-xl flex flex-col">
            <div className="flex items-center justify-between border-b border-[var(--app-border)] px-3 py-2">
              <div className="text-xs font-semibold">Timeline Panel</div>
              <button
                type="button"
                className="rounded border border-[var(--app-border)] px-2 py-1 text-xs"
                onClick={() => setIsRightRailOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <RightRail caseStatus={caseStatus} sessionUser={user} />
            </div>
          </div>
        </div>
      ) : null}

      {shutdownOverlay}

    </div>
  );
}
