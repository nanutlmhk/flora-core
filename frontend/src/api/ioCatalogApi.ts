import { BACKEND_BASE } from "./backendBase";

const BASE = `${BACKEND_BASE}/api/case`;

export type IoKind = "fluid" | "med" | "output";

export type IoCatalogItem = {
  id?: number;
  concept_id?: number;
  kind: IoKind;
  code: string;
  name: string;
  default_unit: string;
  category?: string;
  group_id?: number;
  usage_score?: number;
  usage_rank?: number;
  is_active?: number;
  created_at?: number;
  updated_at?: number;
};

export type IoGroup = {
  id?: number;
  code: string;
  display_name: string;
  kind: IoKind;
  is_active: number;
  sort_order: number;
};

type GetIoCatalogOptions = {
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

function parseItem(row: Record<string, unknown>): IoCatalogItem {
  const kind = text(row.kind);
  return {
    id: numberOrUndefined(row.id),
    concept_id: numberOrUndefined(row.concept_id),
    kind:
      kind === "fluid" || kind === "output" || kind === "med"
        ? kind
        : "med",
    code: text(row.code),
    name: text(row.name),
    default_unit: text(row.default_unit),
    category: text(row.category),
    group_id: numberOrUndefined(row.group_id),
    usage_score: numberOrUndefined(row.usage_score),
    usage_rank: numberOrUndefined(row.usage_rank),
    is_active: numberOrUndefined(row.is_active),
    created_at: numberOrUndefined(row.created_at),
    updated_at: numberOrUndefined(row.updated_at),
  };
}

function parseGroup(row: Record<string, unknown>): IoGroup {
  const kind = text(row.kind);
  return {
    id: numberOrUndefined(row.id), code: text(row.code), display_name: text(row.display_name),
    kind: (kind === "med" || kind === "fluid" || kind === "output" ? kind : "med") as IoKind,
    is_active: Number(row.is_active) || 0, sort_order: Number(row.sort_order) || 0,
  };
}

export async function getIoGroups(opts: { kind?: IoKind; includeInactive?: boolean } = {}): Promise<IoGroup[]> {
  const params = new URLSearchParams();
  if (opts.kind) params.set("kind", opts.kind);
  if (opts.includeInactive) params.set("include_inactive", "true");
  const res = await fetch(`${BASE}/io/groups?${params.toString()}`);
  await throwIfError(res, "group directory failed");
  const json = await res.json() as { rows?: Array<Record<string, unknown>> };
  return (json.rows || []).map(parseGroup);
}

export async function createIoGroup(group: IoGroup): Promise<IoGroup> {
  const res = await fetch(`${BASE}/io/groups`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(group) });
  await throwIfError(res, "group create failed");
  const json = await res.json() as { row?: Record<string, unknown> };
  if (!json.row) throw new Error("group create failed");
  return parseGroup(json.row);
}

export async function updateIoGroup(group: IoGroup): Promise<IoGroup> {
  if (!group.id) throw new Error("group ID required");
  const res = await fetch(`${BASE}/io/groups/${group.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(group) });
  await throwIfError(res, "group update failed");
  const json = await res.json() as { row?: Record<string, unknown> };
  if (!json.row) throw new Error("group update failed");
  return parseGroup(json.row);
}

export async function deactivateIoGroup(groupId: number): Promise<IoGroup> {
  const res = await fetch(`${BASE}/io/groups/${groupId}`, { method: "DELETE" });
  await throwIfError(res, "group deactivate failed");
  const json = await res.json() as { row?: Record<string, unknown> };
  if (!json.row) throw new Error("group deactivate failed");
  return parseGroup(json.row);
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

export async function getIoCatalog(
  opts: GetIoCatalogOptions = {},
): Promise<IoCatalogItem[]> {
  const params = new URLSearchParams();
  params.set("kind", opts.kind || "med");
  params.set("limit", String(opts.limit ?? 300));
  if (opts.q) params.set("q", opts.q);
  if (opts.include_inactive) params.set("include_inactive", "true");

  const res = await fetch(`${BASE}/io/master?${params.toString()}`);
  await throwIfError(res, "I/O catalog failed");

  const json = (await res.json()) as {
    rows?: Array<Record<string, unknown>>;
  };

  return (json.rows || [])
    .map(parseItem)
    .filter(row => row.name && row.code);
}

export async function createIoCatalogEntry(
  item: Partial<IoCatalogItem> & Pick<IoCatalogItem, "name">,
): Promise<IoCatalogItem> {
  const res = await fetch(`${BASE}/io/master`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(item),
  });
  await throwIfError(res, "I/O catalog create failed");

  const json = (await res.json()) as {
    row?: Record<string, unknown>;
  };
  if (!json.row) throw new Error("I/O catalog create failed");
  return parseItem(json.row);
}

export async function updateIoCatalogEntry(
  itemId: number,
  item: Partial<IoCatalogItem>,
): Promise<IoCatalogItem> {
  const res = await fetch(`${BASE}/io/master/${itemId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(item),
  });
  await throwIfError(res, "I/O catalog update failed");

  const json = (await res.json()) as {
    row?: Record<string, unknown>;
  };
  if (!json.row) throw new Error("I/O catalog update failed");
  return parseItem(json.row);
}

export async function deactivateIoCatalogEntry(itemId: number): Promise<void> {
  const res = await fetch(`${BASE}/io/master/${itemId}`, {
    method: "DELETE",
  });
  await throwIfError(res, "I/O catalog delete failed");
}
