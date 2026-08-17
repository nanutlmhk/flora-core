export type BootstrapBackendState =
  | "idle"
  | "starting"
  | "running"
  | "recovering"
  | "error"
  | "stopped";

export type BootstrapStatus = {
  phase: "bootstrap" | "ready";
  backendState: BootstrapBackendState;
  ready: boolean;
  lastError: string;
  lastHealthFailure: string;
  lastExitDetail: string;
  dbPath: string;
  dbExists: boolean;
  dbWalExists: boolean;
  dbShmExists: boolean;
  ivyReadUrl: string;
  ivyHealthUrl: string;
  ivyState: "unknown" | "connected" | "disconnected";
  healthUrls: string[];
  uncleanRecoveryApplied: boolean;
  lastRecoveryAction: string;
  logs: string[];
  updatedAt: number;
};

export type AidasDesktopApi = {
  isElectron: boolean;
  platform: string;
  getEditionInfo?: () => {
    code: "full" | "rcat" | "eforl";
    productName: string;
    version: string;
  };
  setZoomLevel: (level: number) => void;
  getZoomLevel: () => number;
  getBootstrapStatus?: () => Promise<BootstrapStatus>;
  retryBootstrapStart?: () => Promise<BootstrapStatus>;
  runBootstrapSafeRecovery?: () => Promise<BootstrapStatus>;
  stopBootstrapBackend?: () => Promise<BootstrapStatus>;
  onShutdownRequested?: (callback: () => void) => () => void;
  shutdownApp?: () => Promise<unknown>;
  printReport?: () => Promise<unknown>;
  generateReportPdf?: (payload?: Record<string, unknown>) => Promise<unknown>;
  openReportPdfPreview?: (payload?: Record<string, unknown>) => Promise<unknown>;
};

declare global {
  interface Window {
    aidasDesktop?: AidasDesktopApi;
  }
}

export {};
