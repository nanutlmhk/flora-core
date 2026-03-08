import type { AuthUser } from "../auth/useAuth";
import { useTheme } from "../context/ThemeContext";

interface TopBarProps {
  activeView: "case" | "form" | "diagnosis" | "staff" | "drug" | "patient" | "lab" | "report";
  setActiveView: React.Dispatch<
    React.SetStateAction<
      "case" | "form" | "diagnosis" | "staff" | "drug" | "patient" | "lab" | "report"
    >
  >;
  sessionUser: AuthUser | null;
  onLogout: () => void;
  onOpenLeftRail?: () => void;
  onOpenRightRail?: () => void;
}

function BrandLogo() {
  return (
    <svg
      viewBox="0 0 64 64"
      className="h-7 w-7 text-sky-500"
      fill="none"
      aria-hidden="true"
    >
      <g
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9 12 L21 18 L9 24 Z" fill="currentColor" opacity="0.35" />
        <path d="M55 12 L43 18 L55 24 Z" fill="currentColor" opacity="0.35" />
        <path d="M24 13 L32 8 L40 13" />
        <path d="M26 13 L24 40" />
        <path d="M38 13 L40 40" />
        <path d="M24 22 H40" />
        <path d="M23 33 H41" />
        <path d="M27 58 H37 L39 48 H25 Z" />
        <path d="M21 48 H27 L30 42 L34 52 L37 48 H43" />
      </g>
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
      <path
        d="M3 3v18h18M7 14l3-3 3 2 4-5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FormIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
      <path
        d="M8 3h8l4 4v14H8zM16 3v4h4M11 12h6M11 16h6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StaffIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
      <path
        d="M16 20v-1a4 4 0 00-4-4H6a4 4 0 00-4 4v1M9 11a4 4 0 100-8 4 4 0 000 8M22 20v-1a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DiagnosisIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
      <path
        d="M7 3v6a5 5 0 0010 0V3M12 14v3a4 4 0 004 4h1M17 21a2 2 0 100-4 2 2 0 000 4M5 8h3M6.5 6.5v3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FluidMedIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
      <path
        d="M6 3h8v3H6zM5 6h10l-1 8H6zM15 9h4v11h-4M8 10h4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ReportIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
      <path
        d="M4 20h16M7 16v-5M12 16V8M17 16v-3M5 4h14v14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PatientIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
      <path
        d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8M19 8h2M20 7v2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LabIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
      <path
        d="M9 3h6M10 3v6l-5 8a2 2 0 001.7 3h10.6A2 2 0 0019 17l-5-8V3M8 14h8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SunMoonIcon({ dark }: { dark: boolean }) {
  return dark ? (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
      <path
        d="M21 12.8A9 9 0 1111.2 3 7 7 0 0021 12.8z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
      <path
        d="M12 4v2M12 18v2M4 12h2M18 12h2M6.2 6.2l1.4 1.4M16.4 16.4l1.4 1.4M6.2 17.8l1.4-1.4M16.4 7.6l1.4-1.4M12 16a4 4 0 100-8 4 4 0 000 8z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function TopBar({
  activeView,
  setActiveView,
  sessionUser,
  onLogout,
  onOpenLeftRail,
  onOpenRightRail,
}: TopBarProps) {
  const { mode, color, toggleMode, setColor } = useTheme();

  const colorOptions =
    mode === "dark"
      ? [
          { label: "Default", value: "default" },
          { label: "Grey", value: "grey" },
          { label: "Green", value: "green" },
        ]
      : [
          { label: "Default", value: "default" },
          { label: "Old Rose", value: "oldrose" },
          { label: "Pink", value: "pink" },
        ];

  const navItemClass = (view: TopBarProps["activeView"]) =>
    `app-nav-item inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] border-l border-[var(--app-nav-border)] ${
      activeView === view ? "app-nav-item-active" : ""
    }`;

  return (
    <header className="app-topbar h-12 flex items-center px-2 md:px-4 border-b transition-colors duration-300">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenLeftRail}
          className="lg:hidden inline-flex items-center rounded border border-[var(--app-nav-border)] bg-[var(--app-nav-bg)] px-2 py-1 text-xs"
          aria-label="Open case panel"
        >
          Case
        </button>
        <div className="flex items-center gap-2">
          <BrandLogo />
          <div className="font-semibold tracking-wide text-[var(--app-text)]">
            Aidas
          </div>
        </div>

        <select
          className="md:hidden rounded border border-[var(--app-nav-border)] bg-[var(--app-nav-bg)] px-2 py-1 text-xs text-[var(--app-text)]"
          value={activeView}
          onChange={event =>
            setActiveView(
              event.target.value as
                | "case"
                | "form"
                | "diagnosis"
                | "staff"
                | "drug"
                | "patient"
                | "lab"
                | "report",
            )
          }
          aria-label="Select view"
        >
          <option value="case">Chart</option>
          <option value="drug">Fluid&Med</option>
          <option value="diagnosis">Diag/Ops</option>
          <option value="form">Form</option>
          <option value="staff">Staff</option>
          <option value="patient">Patient</option>
          <option value="lab">Lab</option>
          <option value="report">Report</option>
        </select>

        <div className="app-nav-shell ml-2 hidden md:inline-flex rounded-md border overflow-hidden">
          <button
            onClick={() => setActiveView("case")}
            className={`app-nav-item inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] ${
              activeView === "case" ? "app-nav-item-active" : ""
            }`}
          >
            <ChartIcon />
            Chart
          </button>
          <button
            onClick={() => setActiveView("drug")}
            className={navItemClass("drug")}
          >
            <FluidMedIcon />
            Fluid&Med
          </button>
          <button
            onClick={() => setActiveView("diagnosis")}
            className={navItemClass("diagnosis")}
          >
            <DiagnosisIcon />
            Diag/Ops
          </button>
          <button
            onClick={() => setActiveView("form")}
            className={navItemClass("form")}
          >
            <FormIcon />
            Form
          </button>
          <button
            onClick={() => setActiveView("staff")}
            className={navItemClass("staff")}
          >
            <StaffIcon />
            Staff
          </button>
          <button
            onClick={() => setActiveView("patient")}
            className={navItemClass("patient")}
          >
            <PatientIcon />
            Patient
          </button>
          <button
            onClick={() => setActiveView("lab")}
            className={navItemClass("lab")}
          >
            <LabIcon />
            Lab
          </button>
          <button
            onClick={() => setActiveView("report")}
            className={navItemClass("report")}
          >
            <ReportIcon />
            Report
          </button>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2 md:gap-3">
        <button
          type="button"
          onClick={onOpenRightRail}
          className="lg:hidden inline-flex items-center rounded border border-[var(--app-nav-border)] bg-[var(--app-nav-bg)] px-2 py-1 text-xs"
          aria-label="Open timeline panel"
        >
          Timeline
        </button>

        <div className="flex items-center gap-1.5">
          <button
            onClick={toggleMode}
            className="inline-flex h-8 items-center gap-1.5 rounded border border-[var(--app-nav-border)] bg-[var(--app-nav-bg)] px-2 text-[var(--app-text)] transition-all hover:bg-[var(--app-nav-hover)]"
            title={`Switch to ${mode === "light" ? "Dark" : "Light"} mode`}
          >
            <SunMoonIcon dark={mode === "dark"} />
            <span className="hidden lg:inline capitalize">{mode}</span>
          </button>

          <select
            value={color}
            onChange={e => setColor(e.target.value as any)}
            className="h-8 rounded border border-[var(--app-nav-border)] bg-[var(--app-nav-bg)] px-2 text-[11px] text-[var(--app-text)] transition-all hover:bg-[var(--app-nav-hover)] focus:outline-none"
          >
            {colorOptions.map(opt => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="hidden sm:block text-[var(--app-text)]">
          {sessionUser?.name || sessionUser?.username || "user@demo"}
        </div>
        <button
          onClick={onLogout}
          className="inline-flex h-8 items-center gap-1.5 rounded border border-[var(--app-nav-border)] bg-[var(--app-nav-bg)] px-2.5 py-1 text-[var(--app-text)] transition-all hover:bg-[var(--app-nav-hover)]"
        >
          Logout
        </button>
      </div>
    </header>
  );
}
