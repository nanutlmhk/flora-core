import { BACKEND_BASE } from "./backendBase";
import { readStoredAuthToken } from "./authApi";

export type LeafNode = {
  leaf_id: string;
  hospital_id: string;
  display_name: string;
  software_version?: string | null;
  last_seen_at: string;
  connection_status: "online" | "delayed" | "offline";
  hospital_name?: string | null;
  building_name?: string | null;
  care_unit_name?: string | null;
  room_name?: string | null;
  bed_name?: string | null;
  desired_version?: number | null;
  applied_version?: number | null;
  config_status?: "unassigned" | "pending" | "outdated" | "synced";
};

export type ControlPlaneLocation = {
  id: number;
  parent_id?: number | null;
  kind: "hospital" | "building" | "care_unit" | "room" | "bed";
  code?: string | null;
  name: string;
  is_active: boolean;
  sort_order: number;
};

export type ControlPlaneGroup = {
  id: number;
  name: string;
  description: string;
  is_active: boolean;
  leaf_ids: string[];
};

export type ControlPlaneLeaf = LeafNode & {
  bed_location_id?: number | null;
  desired_config?: Record<string, unknown> | null;
  desired_version?: number | null;
  applied_version?: number | null;
  config_status: "unassigned" | "pending" | "outdated" | "synced";
};

export type ControlPlane = {
  locations: ControlPlaneLocation[];
  groups: ControlPlaneGroup[];
  leaves: ControlPlaneLeaf[];
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
  discharge_time?: number | null;
  admission_source?: string | null;
  source_system?: string | null;
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

async function sendJson<T>(path: string, method: "POST" | "PUT", body: unknown): Promise<T> {
  const token = readStoredAuthToken();
  const response = await fetch(`${BACKEND_BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { "X-FLORA-Session": token } : {}) },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `Fleet request failed (${response.status})`);
  return data as T;
}

export const getLeaves = () => rows<LeafNode>("/api/fleet/leaves");
export const getActiveFleetCases = () => rows<FleetCase>("/api/fleet/active-cases");
export const getFleetCases = (limit = 50, status?: "ACTIVE" | "DISCHARGED" | "ARCHIVED") => {
  const params = new URLSearchParams({ limit: String(limit) });
  if (status) params.set("status", status);
  return rows<FleetCase>(`/api/fleet/cases?${params.toString()}`);
};
export const getFleetCaseSnapshot = (globalCaseId: string) =>
  getJson<{ snapshot: Record<string, unknown>; leaf_name: string; last_synced_at: string }>(
    `/api/fleet/cases/${encodeURIComponent(globalCaseId)}/snapshot`,
  );

export const getControlPlane = () => getJson<ControlPlane>("/api/fleet/control");
export const createControlLocation = (input: Omit<ControlPlaneLocation, "id">) =>
  sendJson<ControlPlaneLocation>("/api/fleet/control/locations", "POST", input);
export const updateControlLocation = (id: number, input: Omit<ControlPlaneLocation, "id">) =>
  sendJson<ControlPlaneLocation>(`/api/fleet/control/locations/${id}`, "PUT", input);
export const createLeafGroup = (input: Pick<ControlPlaneGroup, "name" | "description" | "is_active">) =>
  sendJson<ControlPlaneGroup>("/api/fleet/control/groups", "POST", input);
export const updateLeafGroup = (id: number, input: Pick<ControlPlaneGroup, "name" | "description" | "is_active">) =>
  sendJson<ControlPlaneGroup>(`/api/fleet/control/groups/${id}`, "PUT", input);
export const updateLeafGroupMembers = (id: number, leafIds: string[]) =>
  sendJson<{ ok: boolean }>(`/api/fleet/control/groups/${id}/members`, "PUT", { leaf_ids: leafIds });
export const assignLeafLocation = (leafId: string, input: { bed_location_id: number; timezone: string; date_format: string; time_format: string }) =>
  sendJson<Record<string, unknown>>(`/api/fleet/control/leaves/${encodeURIComponent(leafId)}/assignment`, "PUT", input);
export const adoptObservedLeafLocation = (leafId: string) =>
  sendJson<Record<string, unknown>>(`/api/fleet/control/leaves/${encodeURIComponent(leafId)}/adopt-observed`, "POST", {});
export const applyLeafGroupSettings = (id: number, input: { timezone: string; date_format: string; time_format: string }) =>
  sendJson<{ ok: boolean; updated: number }>(`/api/fleet/control/groups/${id}/settings`, "PUT", input);
