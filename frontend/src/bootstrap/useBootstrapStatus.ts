import { useCallback, useEffect, useState } from "react";
import type { BootstrapStatus } from "./floraDesktop";
import { BACKEND_BASE } from "../api/backendBase";

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
  dataMode: "local",
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
  const [status, setStatus] = useState<BootstrapStatus>(() => ({
    ...READY_STATUS,
    ready: false,
    phase: "bootstrap",
    backendState: "starting",
    dbExists: false,
  }));
  const [lastHidroOnlineAt, setLastHidroOnlineAt] = useState(0);

  const refresh = useCallback(async () => {
    const desktop = window.floraDesktop;
    if (!desktop?.getBootstrapStatus) {
      const response = await fetch(`${BACKEND_BASE}/health`, { cache: "no-store" });
      if (!response.ok) throw new Error("Flora system is unavailable");
      const health = await response.json() as { status?: string; data_ready?: boolean; data_mode?: "local" | "server" };
      const ready = health.data_ready === true || (health.status === "OK" && health.data_ready !== false);
      const host = new URL(BACKEND_BASE).hostname.toLowerCase();
      const dataMode = health.data_mode || (["localhost", "127.0.0.1", "::1", "[::1]"].includes(host) ? "local" : "server");
      const next: BootstrapStatus = {
        ...READY_STATUS,
        ready,
        phase: ready ? "ready" : "bootstrap",
        backendState: ready ? "running" : "error",
        dbExists: ready,
        dataMode,
        lastError: ready ? "" : "Flora data is unavailable",
        updatedAt: Date.now(),
      };
      setStatus(next);
      return next;
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
            dbExists: false,
            lastError: "Flora system is unavailable",
            updatedAt: Date.now(),
          }));
        }
      }
    };

    void tick();
    const id = window.setInterval(() => {
      void tick();
    }, window.floraDesktop ? 1200 : 5000);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [refresh]);

  const retryStart = useCallback(async () => {
    const desktop = window.floraDesktop;
    if (!desktop?.retryBootstrapStart) return refresh();
    const next = await desktop.retryBootstrapStart();
    setStatus(next);
    return next;
  }, [refresh]);

  const safeRecovery = useCallback(async () => {
    const desktop = window.floraDesktop;
    if (!desktop?.runBootstrapSafeRecovery) return refresh();
    const next = await desktop.runBootstrapSafeRecovery();
    setStatus(next);
    return next;
  }, [refresh]);

  const stopBackend = useCallback(async () => {
    const desktop = window.floraDesktop;
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
