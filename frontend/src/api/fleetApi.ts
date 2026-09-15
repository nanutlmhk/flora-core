import { BACKEND_BASE } from "./backendBase";
import { readStoredAuthToken } from "./authApi";

export type LeafNode = {
  leaf_id: string;
  hospital_id: string;
  display_name: string;
  software_version?: string | null;
  last_seen_at: string;
  connection_status: "online" | "delayed" | "offline";
};

export type FleetCase = {
  global_case_id: string;
  hospital_id: string;
  leaf_id: string;
  leaf_name: string;
  source_case_id: string;
  case_code?: string | null;
  hn?: string | null;
  status: string;
  start_time?: number | null;
  last_synced_at: string;
  sync_status: "live" | "delayed" | "offline";
};

async function rows<T>(path: string): Promise<T[]> {
  const token = readStoredAuthToken();
  const response = await fetch(`${BACKEND_BASE}${path}`, {
    headers: token ? { "X-FLORA-Session": token } : {},
  });
  if (!response.ok) throw new Error(`Fleet request failed (${response.status})`);
  return ((await response.json()) as { rows?: T[] }).rows || [];
}

async function getJson<T>(path: string): Promise<T> {
  const token = readStoredAuthToken();
  const response = await fetch(`${BACKEND_BASE}${path}`, {
    headers: token ? { "X-FLORA-Session": token } : {},
  });
  if (!response.ok) throw new Error(`Fleet request failed (${response.status})`);
  return response.json() as Promise<T>;
}

export const getLeaves = () => rows<LeafNode>("/api/fleet/leaves");
export const getActiveFleetCases = () => rows<FleetCase>("/api/fleet/active-cases");
export const getFleetCaseSnapshot = (globalCaseId: string) =>
  getJson<{ snapshot: Record<string, unknown>; leaf_name: string; last_synced_at: string }>(
    `/api/fleet/cases/${encodeURIComponent(globalCaseId)}/snapshot`,
  );
