import type { CaseStatus } from "../api/caseApi";
import type { AuthUser } from "../auth/useAuth";
import { useLanguage } from "../context/LanguageContext";
import { getSurfaceInfo } from "../edition/config";
import ClinicalReferenceTooltip from "../components/common/ClinicalReferenceTooltip";
import chartMenuIcon from "../assets/menu-chart.png";
import ioMenuIcon from "../assets/menu-io.png";
import clinicalMenuIcon from "../assets/menu-clinical.png";
import formMenuIcon from "../assets/menu-form.png";
import staffMenuIcon from "../assets/menu-staff.png";
import patientMenuIcon from "../assets/menu-patient.png";
import reportMenuIcon from "../assets/menu-report.png";
import configMenuIcon from "../assets/menu-config.png";
import archiveMenuIcon from "../assets/menu-archive.png";

export type AppView = "case" | "form" | "diagnosis" | "staff" | "io" | "patient" | "report" | "master" | "account" | "fleet" | "history";

type Props = {
  activeView: AppView;
  setActiveView: (view: AppView) => void;
  sessionUser: AuthUser | null;
  caseStatus: CaseStatus;
  collapsed: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
};

type NavIconName = "chart" | "io" | "clinical" | "form" | "staff" | "patient" | "report" | "config" | "archive" | "start" | "fleet";
type NavItem = { view: AppView; label: string; icon: NavIconName };

const menuIcons: Partial<Record<NavIconName, string>> = {
  chart: chartMenuIcon,
  io: ioMenuIcon,
  clinical: clinicalMenuIcon,
  form: formMenuIcon,
  staff: staffMenuIcon,
  patient: patientMenuIcon,
  report: reportMenuIcon,
  config: configMenuIcon,
  archive: archiveMenuIcon,
};

function NavIcon({ name }: { name: NavIconName }) {
  const image = menuIcons[name];
  if (image) {
    return <img src={image} alt="" draggable={false} className="flora-menu-sprite h-7 w-7 shrink-0 object-contain select-none" style={{ imageRendering: "pixelated" }} aria-hidden="true" />;
  }
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true" {...common}>
    {name === "chart" ? <><path d="M4 19V5"/><path d="M4 19h16"/><path d="m7 15 3-4 3 2 4-6"/><circle cx="7" cy="15" r=".8" fill="currentColor" stroke="none"/><circle cx="17" cy="7" r=".8" fill="currentColor" stroke="none"/></>
      : name === "io" ? <><path d="M8 3v15"/><path d="m5 15 3 3 3-3"/><path d="M16 21V6"/><path d="m13 9 3-3 3 3"/></>
      : name === "clinical" ? <><path d="M9 3h6l1 2h3v16H5V5h3l1-2Z"/><path d="M9 12h6M12 9v6"/></>
      : name === "form" ? <><path d="M6 3h9l3 3v15H6Z"/><path d="M15 3v4h4M9 11h6M9 15h6M9 19h4"/></>
      : name === "staff" ? <><circle cx="9" cy="8" r="3"/><path d="M3.5 20c.4-4 2.2-6 5.5-6s5.1 2 5.5 6"/><circle cx="17" cy="9" r="2.2"/><path d="M15.5 15c3.2-.8 5.1.8 5.5 4"/></>
      : name === "patient" ? <><circle cx="12" cy="8" r="3.2"/><path d="M5 21c.5-5 2.8-7.5 7-7.5s6.5 2.5 7 7.5"/></>
      : name === "report" ? <><path d="M5 3h11l3 3v15H5Z"/><path d="M16 3v4h4M8 17v-3M12 17v-6M16 17V9"/></>
      : name === "config" ? <><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></>
      : name === "archive" ? <><path d="M4 6h16v15H4Z"/><path d="M3 3h18v4H3ZM9 11h6"/></>
      : name === "start" ? <><circle cx="9" cy="8" r="3"/><path d="M3.5 20c.4-4 2.2-6 5.5-6 1.3 0 2.4.3 3.2.8M18 13v7M14.5 16.5h7"/></>
      : <><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4M7 12l3-3 2 2 4-4"/></>}
  </svg>;
}

function SidebarBody({ activeView, setActiveView, sessionUser, caseStatus, collapsed, onCloseMobile }: Omit<Props, "mobileOpen">) {
  const { t } = useLanguage();
  const surface = getSurfaceInfo();
  const permissions = sessionUser?.permissions || [];
  const isIdleLeaf = surface.code === "leaf" && caseStatus.status === "IDLE";
  const canConfigure = permissions.some(permission => ["account.manage", "config.manage", "clinical_master.manage", "staff.manage"].includes(permission));
  const canReport = permissions.includes("report.generate");
  const items: NavItem[] = surface.code === "canopy"
    ? [{ view: "fleet", label: "Live overview", icon: "fleet" }, { view: "history", label: t("topbar.archive"), icon: "archive" }]
    : isIdleLeaf
      ? [
          { view: "case", label: t("topbar.startCase"), icon: "start" },
          ...(canConfigure ? [{ view: "master" as AppView, label: t("topbar.config"), icon: "config" as NavIconName }] : []),
          { view: "history", label: t("topbar.archive"), icon: "archive" },
        ]
      : [
          { view: "case", label: "Chart", icon: "chart" },
          { view: "io", label: "I/O", icon: "io" },
          { view: "diagnosis", label: "Diag/Ops", icon: "clinical" },
          { view: "form", label: "Forms", icon: "form" },
          { view: "staff", label: "Staff", icon: "staff" },
          { view: "patient", label: "Patient", icon: "patient" },
          ...(canReport ? [{ view: "report" as AppView, label: "Reports", icon: "report" as NavIconName }] : []),
          ...(canConfigure ? [{ view: "master" as AppView, label: t("topbar.config"), icon: "config" as NavIconName }] : []),
          { view: "history", label: t("topbar.archive"), icon: "archive" },
        ];

  const navigate = (view: AppView) => {
    setActiveView(view);
    onCloseMobile();
  };

  return <div className="flex h-full flex-col bg-[var(--app-panel-bg)] text-[var(--app-text)]">
    <div className="flex h-14 items-center justify-between border-b border-[var(--app-border)] px-3 md:hidden">
      <span className="text-xs font-extrabold uppercase tracking-[0.16em] text-[var(--app-muted)]">Workspace</span>
      <button type="button" onClick={onCloseMobile} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--app-border)] bg-[var(--app-control-bg)] text-lg" aria-label="Close navigation">×</button>
    </div>
    <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2" aria-label="Workspace navigation">
      {items.map(item => <ClinicalReferenceTooltip key={item.view} text={item.label} compact disabled={!collapsed} className="w-full"><button type="button" onClick={() => navigate(item.view)} aria-label={item.label} aria-current={activeView === item.view ? "page" : undefined} className={`flora-nav-item flex h-12 w-full items-center rounded-xl border text-sm font-semibold transition ${collapsed ? "justify-center" : "gap-3 px-3"} ${activeView === item.view ? "border-[var(--app-accent)] bg-[var(--app-accent)] text-[var(--app-accent-contrast)]" : "border-transparent hover:bg-[var(--app-control-bg)]"}`}><span className="flora-nav-icon inline-flex h-9 w-9 shrink-0 items-center justify-center"><NavIcon name={item.icon} /></span>{!collapsed ? <span className="truncate">{item.label}</span> : null}</button></ClinicalReferenceTooltip>)}
    </nav>
  </div>;
}

export default function AppSidebar(props: Props) {
  const shared = { ...props };
  return <>
    <aside className={`app-rail hidden shrink-0 border-r md:block ${props.collapsed ? "w-16" : "w-56"}`}><SidebarBody {...shared} /></aside>
    {props.mobileOpen ? <div className="fixed inset-0 z-[1150] md:hidden"><button type="button" aria-label="Close navigation" onClick={props.onCloseMobile} className="absolute inset-0 bg-black/55" /><aside className="app-rail absolute inset-y-0 left-0 w-[82vw] max-w-[280px] border-r shadow-2xl"><SidebarBody {...shared} collapsed={false} /></aside></div> : null}
  </>;
}
