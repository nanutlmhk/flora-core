const BASE = "http://localhost:3001/api/case";

export type IoKind = "fluid" | "med" | "output";

export type DrugDirectoryItem = {
  id?: number;
  kind: IoKind;
  code: string;
  name: string;
  default_unit: string;
  category?: string;
  is_active?: number;
  created_at?: number;
  updated_at?: number;
};

type GetDrugDirectoryOptions = {
  kind?: IoKind;
  limit?: number;
  q?: string;
  include_inactive?: boolean;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberOrUndefined(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function parseItem(row: Record<string, unknown>): DrugDirectoryItem {
  const kind = text(row.kind);
  return {
    id: numberOrUndefined(row.id),
    kind:
      kind === "fluid" || kind === "output" || kind === "med"
        ? kind
        : "med",
    code: text(row.code),
    name: text(row.name),
    default_unit: text(row.default_unit),
    category: text(row.category),
    is_active: numberOrUndefined(row.is_active),
    created_at: numberOrUndefined(row.created_at),
    updated_at: numberOrUndefined(row.updated_at),
  };
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
    // ignore non-json error body
  }
  throw new Error(`${fallback} ${res.status}${detail}`);
}

export async function getDrugDirectory(
  opts: GetDrugDirectoryOptions = {},
): Promise<DrugDirectoryItem[]> {
  const params = new URLSearchParams();
  params.set("kind", opts.kind || "med");
  params.set("limit", String(opts.limit ?? 300));
  if (opts.q) params.set("q", opts.q);
  if (opts.include_inactive) params.set("include_inactive", "true");

  const res = await fetch(`${BASE}/io/master?${params.toString()}`);
  await throwIfError(res, "drug directory failed");

  const json = (await res.json()) as {
    rows?: Array<Record<string, unknown>>;
  };

  return (json.rows || [])
    .map(parseItem)
    .filter(row => row.name && row.code);
}

export async function createDrugDirectoryEntry(
  item: Partial<DrugDirectoryItem> & Pick<DrugDirectoryItem, "name">,
): Promise<DrugDirectoryItem> {
  const res = await fetch(`${BASE}/io/master`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(item),
  });
  await throwIfError(res, "drug directory create failed");

  const json = (await res.json()) as {
    row?: Record<string, unknown>;
  };
  if (!json.row) throw new Error("drug directory create failed");
  return parseItem(json.row);
}

export async function updateDrugDirectoryEntry(
  itemId: number,
  item: Partial<DrugDirectoryItem>,
): Promise<DrugDirectoryItem> {
  const res = await fetch(`${BASE}/io/master/${itemId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(item),
  });
  await throwIfError(res, "drug directory update failed");

  const json = (await res.json()) as {
    row?: Record<string, unknown>;
  };
  if (!json.row) throw new Error("drug directory update failed");
  return parseItem(json.row);
}

export async function deactivateDrugDirectoryEntry(itemId: number): Promise<void> {
  const res = await fetch(`${BASE}/io/master/${itemId}`, {
    method: "DELETE",
  });
  await throwIfError(res, "drug directory delete failed");
}
