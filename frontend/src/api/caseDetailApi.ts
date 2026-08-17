const BASE = "http://localhost:3001/api/case";

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

async function throwIfError(res: Response, fallback: string) {
  if (res.ok) return;
  let detail = "";
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error.trim()) {
      detail = `: ${body.error.trim()}`;
    }
  } catch {
    // ignore non-json body
  }
  throw new Error(`${fallback} ${res.status}${detail}`);
}

export async function getCaseDetailDraft(caseId: number): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${BASE}/${caseId}/detail-draft`);
  await throwIfError(res, "case detail draft load failed");
  const json = (await res.json()) as { draft?: unknown };
  return asObject(json.draft);
}

export async function saveCaseDetailDraft(
  caseId: number,
  draft: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(`${BASE}/${caseId}/detail-draft`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ draft }),
  });
  await throwIfError(res, "case detail draft save failed");
}

export async function deleteCaseDetailDraft(caseId: number): Promise<void> {
  const res = await fetch(`${BASE}/${caseId}/detail-draft`, {
    method: "DELETE",
  });
  await throwIfError(res, "case detail draft delete failed");
}
