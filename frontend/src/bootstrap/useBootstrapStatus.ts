import { useCallback, useEffect, useState } from "react";
import type { BootstrapStatus } from "./aidasDesktop";

const HIDRO_OFFLINE_GRACE_MS = 5000;

const READY_STATUS: BootstrapStatus = {
  phase: "ready",
  backendState: "running",
  ready: true,
  lastError: "",
  lastHealthFailure: "",
  lastExitDetail: "",
  dbPath: "",
  dbExists: true,
  dbWalExists: false,
  dbShmExists: false,
  ivyReadUrl: "",
  ivyHealthUrl: "",
  ivyState: "unknown",
  healthUrls: [],
  uncleanRecoveryApplied: false,
  lastRecoveryAction: "",
  logs: [],
  updatedAt: 0,
};

export function useBootstrapStatus() {
  const [status, setStatus] = useState<BootstrapStatus>(READY_STATUS);
  const [lastHidroOnlineAt, setLastHidroOnlineAt] = useState(0);

  const refresh = useCallback(async () => {
    const desktop = window.aidasDesktop;
    if (!desktop?.getBootstrapStatus) {
      setStatus(READY_STATUS);
      return READY_STATUS;
    }
    const next = await desktop.getBootstrapStatus();
    const now = Date.now();
    let stabilized = next;

    if (next.ivyState === "connected") {
      setLastHidroOnlineAt(now);
    } else if (
      next.ivyState === "disconnected" &&
      lastHidroOnlineAt > 0 &&
      now - lastHidroOnlineAt < HIDRO_OFFLINE_GRACE_MS
    ) {
      stabilized = { ...next, ivyState: "connected" };
    }

    setStatus(stabilized);
    return stabilized;
  }, [lastHidroOnlineAt]);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      try {
        await refresh();
        if (cancelled) return;
      } catch {
        if (!cancelled) {
          setStatus(prev => ({
            ...prev,
            ready: false,
            phase: "bootstrap",
            backendState: "error",
            lastError: "Unable to read desktop bootstrap status",
            updatedAt: Date.now(),
          }));
        }
      }
    };

    void tick();
    const id = window.setInterval(() => {
      void tick();
    }, 1200);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [refresh]);

  const retryStart = useCallback(async () => {
    const desktop = window.aidasDesktop;
    if (!desktop?.retryBootstrapStart) return refresh();
    const next = await desktop.retryBootstrapStart();
    setStatus(next);
    return next;
  }, [refresh]);

  const safeRecovery = useCallback(async () => {
    const desktop = window.aidasDesktop;
    if (!desktop?.runBootstrapSafeRecovery) return refresh();
    const next = await desktop.runBootstrapSafeRecovery();
    setStatus(next);
    return next;
  }, [refresh]);

  const stopBackend = useCallback(async () => {
    const desktop = window.aidasDesktop;
    if (!desktop?.stopBootstrapBackend) return refresh();
    const next = await desktop.stopBootstrapBackend();
    setStatus(next);
    return next;
  }, [refresh]);

  return {
    status,
    refresh,
    retryStart,
    safeRecovery,
    stopBackend,
  };
}
