import { useCallback, useEffect, useState } from "react";
import TopBar from "./layout/TopBar";
import LeftRail from "./layout/LeftRail";
import MainArea from "./layout/MainArea";
import RightRail from "./layout/RightRail";
import { getCaseStatus } from "./api/caseApi";
import type { CaseStatus } from "./api/caseApi";
import LoginPage from "./auth/LoginPage";
import { useAuth } from "./auth/useAuth";

const LEFT_RAIL_COLLAPSED_KEY = "aidas.ui.leftRailCollapsed";
const RIGHT_RAIL_COLLAPSED_KEY = "aidas.ui.rightRailCollapsed";

function readStoredBool(key: string, fallback: boolean) {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  if (raw == null) return fallback;
  return raw === "1";
}

export default function App() {
  const { user, ready, isAuthenticated, login, logout } = useAuth();
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
    "case" | "form" | "diagnosis" | "staff" | "drug" | "patient" | "lab" | "report"
  >("case");

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
      return { ...prev, discharge_time: dischargeTime };
    });
  }, []);

  useEffect(() => {
    refreshCase();
  }, [refreshCase]);

  useEffect(() => {
    if (caseStatus.status === "IDLE" && activeView === "form") {
      setActiveView("case");
    }
  }, [activeView, caseStatus.status]);

  useEffect(() => {
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

        // Only works in Electron where aidasDesktop is available
        const desktop = (window as any).aidasDesktop;
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

  if (!ready) {
    return null;
  }

  if (!isAuthenticated) {
    return <LoginPage onLogin={login} />;
  }

  return (
    <div className="app-shell app-theme-scope h-screen font-sans flex flex-col">
      <TopBar
        activeView={activeView}
        setActiveView={setActiveView}
        sessionUser={user}
        onLogout={logout}
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
          <div className="app-rail hidden lg:flex w-5 border-r items-center justify-center">
            <button
              type="button"
              className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-1 py-0.5 text-[10px]"
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
              className="absolute -right-2 top-1/2 z-10 -translate-y-1/2 rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-1 py-0.5 text-[10px]"
              title="Collapse left rail"
              onClick={() => setIsLeftRailCollapsed(true)}
            >
              {"<"}
            </button>
            <LeftRail
              caseStatus={caseStatus}
              onCaseChange={refreshCase}
              onSelectCase={openCaseFromHistory}
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
          />
        </div>

        {isRightRailCollapsed ? (
          <div className="app-rail hidden lg:flex w-5 border-l items-center justify-center">
            <button
              type="button"
              className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-1 py-0.5 text-[10px]"
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
              className="absolute -left-2 top-1/2 z-10 -translate-y-1/2 rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-1 py-0.5 text-[10px]"
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
                onSelectCase={openCaseFromHistory}
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
    </div>
  );
}
