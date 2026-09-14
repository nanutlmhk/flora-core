import { BACKEND_BASE } from "./backendBase";

const BASE = `${BACKEND_BASE}/api/case`;

export async function getTimeAxis(
  caseId: number,
  stepMin = 1,
): Promise<{ axis: number[]; serverTime: number }> {
  const params = new URLSearchParams({
    step: String(Math.max(1, stepMin)),
  });
  const res = await fetch(`${BASE}/${caseId}/timeaxis?${params.toString()}`);

  if (!res.ok) {
    throw new Error(`timeaxis fetch failed ${res.status}`);
  }

  const data = await res.json();
  return { axis: data.axis, serverTime: Number(data.server_time) };
}
