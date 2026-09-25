import { BACKEND_BASE } from "./backendBase";

const BASE = `${BACKEND_BASE}/api/workstation/context`;
export const WORKSTATION_CONTEXT_STORAGE_KEY = "flora.workstation.context";

export type WorkstationContext = {
  hospitalName: string;
  buildingName: string;
  careUnitName: string;
  roomName: string;
  bedName: string;
  timezone: string;
  dateFormat: "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD";
  timeFormat: "24h" | "12h";
  updatedAt: number;
  controlPlaneVersion?: number;
};

export async function getWorkstationContext(): Promise<WorkstationContext> {
  const response = await fetch(BASE);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || "Unable to load workstation context");
  return data as WorkstationContext;
}

export async function updateWorkstationContext(
  context: Omit<WorkstationContext, "updatedAt">,
): Promise<WorkstationContext> {
  const response = await fetch(BASE, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(context),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || "Unable to save workstation context");
  try {
    window.localStorage.setItem(WORKSTATION_CONTEXT_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Saving on the server succeeded even if browser storage is unavailable.
  }
  return data as WorkstationContext;
}
