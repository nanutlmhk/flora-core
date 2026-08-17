const BASE = "http://localhost:3001/api/case";

export async function getTimeAxis(
  caseId: number,
  stepMin = 1,
): Promise<number[]> {
  const params = new URLSearchParams({
    step: String(Math.max(1, stepMin)),
  });
  const res = await fetch(`${BASE}/${caseId}/timeaxis?${params.toString()}`);

  if (!res.ok) {
    throw new Error(`timeaxis fetch failed ${res.status}`);
  }

  const data = await res.json();
  return data.axis;
}
