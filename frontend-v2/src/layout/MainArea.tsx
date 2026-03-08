import { Component, type ErrorInfo, type ReactNode } from "react";
import type { CaseStatus } from "../api/caseApi";
import type { AuthUser } from "../auth/useAuth";
import CaseView from "../views/CaseView";
import FormView from "../views/FormView";
import StaffView from "../views/StaffView";
import DrugView from "../views/DrugView";
import DiagnosisView from "../views/DiagnosisView";
import ReportView from "../views/ReportView";
import PatientView from "../views/PatientView";
import LabView from "../views/LabView";

interface Props {
  caseStatus: CaseStatus;
  activeView: "case" | "form" | "diagnosis" | "staff" | "drug" | "patient" | "lab" | "report";
  sessionUser: AuthUser | null;
}

class ViewErrorBoundary extends Component<
  { resetKey: string; children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    console.error("MainArea view render failed:", error, errorInfo);
  }

  componentDidUpdate(prevProps: { resetKey: string }) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 space-y-2 text-sm text-amber-700 dark:text-amber-300">
          <div>View failed to load.</div>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false })}
            className="rounded border border-amber-500/50 px-2 py-1 text-xs hover:bg-amber-500/10"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function MainArea({
  caseStatus,
  activeView,
  sessionUser,
}: Props) {
  const resetKey =
    caseStatus.status === "IDLE"
      ? `${activeView}:IDLE`
      : `${activeView}:${caseStatus.case_id}:${caseStatus.status}`;

  return (
    <ViewErrorBoundary resetKey={resetKey}>
      {activeView === "case" && caseStatus.status === "IDLE" ? (
        <PatientView caseStatus={caseStatus} />
      ) : activeView === "form" ? (
        <FormView caseStatus={caseStatus} />
      ) : activeView === "diagnosis" ? (
        <DiagnosisView caseStatus={caseStatus} />
      ) : activeView === "staff" ? (
        <StaffView caseStatus={caseStatus} sessionUser={sessionUser} />
      ) : activeView === "drug" ? (
        <DrugView caseStatus={caseStatus} />
      ) : activeView === "patient" ? (
        <PatientView caseStatus={caseStatus} />
      ) : activeView === "lab" ? (
        <LabView caseStatus={caseStatus} />
      ) : activeView === "report" ? (
        <ReportView caseStatus={caseStatus} />
      ) : (
        <CaseView caseStatus={caseStatus} sessionUser={sessionUser} />
      )}
    </ViewErrorBoundary>
  );
}
