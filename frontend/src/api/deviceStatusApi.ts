const BASE = "http://localhost:3000";

export type DeviceStatusRow = {
  device_id: string | null;
  device_key: string;
  source: string | null;
  protocol: string | null;
  is_online: boolean;
  status: "online" | "offline";
  last_seen_ts: number | null;
  seconds_since_last: number | null;
  total_samples: number;
  samples_in_window: number;
  latest_observation: {
    raw_code: string | null;
    ivy_param: string | null;
    value: unknown;
    unit: string | null;
    system_ts: number | null;
  } | null;
};

export type DeviceStatusSnapshot = {
  server_ts: number;
  server_uptime_sec: number;
  online_window_sec: number;
  summary: {
    total_observations: number;
    last_observation_ts: number | null;
    total_devices: number;
    online_devices: number;
  };
  liveagent: {
    online: boolean;
    device_count: number;
    last_seen_ts: number | null;
  };
  logical_devices?: Array<{
    id: "patient_monitor" | "anesthesia_machine" | string;
    label: string;
    is_online: boolean;
    status: "online" | "offline";
    data_status?:
      | "live"
      | "retrieving"
      | "no_recent_data"
      | "no_data_yet"
      | "stale"
      | "offline"
      | "disabled";
    last_seen_ts: number | null;
    seconds_since_last: number | null;
    total_samples: number;
    samples_in_window: number;
    device_count: number;
    device_ids: string[];
    transport?: {
      service_running: boolean;
      transport_connected: boolean;
      transport_connecting: boolean;
      transport_status: "connected" | "connecting" | "waiting" | "disconnected" | "disabled" | "unknown";
      selected_label: string | null;
      current_target: string | null;
      last_connect_at: number | null;
      last_error: string | null;
      reason: string | null;
    };
    latest_observation: {
      raw_code: string | null;
      ivy_param: string | null;
      value: unknown;
      unit: string | null;
      system_ts: number | null;
      device_id?: string | null;
    } | null;
  }>;
  devices: DeviceStatusRow[];
};

export async function getDeviceStatus(
  onlineWindowSec = 30,
): Promise<DeviceStatusSnapshot> {
  const params = new URLSearchParams({
    online_window_sec: String(onlineWindowSec),
  });
  const res = await fetch(`${BASE}/api/devices/status?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`device status failed ${res.status}`);
  }
  return (await res.json()) as DeviceStatusSnapshot;
}
