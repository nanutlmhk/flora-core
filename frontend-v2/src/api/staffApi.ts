const BASE = "http://localhost:3001/api/case";

export type StaffRole = {
  id: string;
  name: string;
  sort_order: number;
};

export type StaffMember = {
  id?: number;
  hospital_id?: string;
  personal_id?: string;
  email?: string;
  th_first_name?: string;
  th_last_name?: string;
  en_first_name?: string;
  en_last_name?: string;
  innovian_id?: string;
  role_id?: string;
  entry_year?: number | null;
  is_active?: number;
  name: string;
  role: string;
};

export type StaffLibraryItem = StaffMember & {
  used_count: number;
  last_used_at: number;
  created_at?: number;
  updated_at?: number;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseStaffRow(row: Record<string, unknown>): StaffMember {
  return {
    id: numberOrNull(row.id) ?? undefined,
    hospital_id: text(row.hospital_id),
    personal_id: text(row.personal_id),
    email: text(row.email),
    th_first_name: text(row.th_first_name),
    th_last_name: text(row.th_last_name),
    en_first_name: text(row.en_first_name),
    en_last_name: text(row.en_last_name),
    innovian_id: text(row.innovian_id),
    role_id: text(row.role_id),
    entry_year: numberOrNull(row.entry_year),
    is_active: numberOrNull(row.is_active) ?? undefined,
    name: text(row.name),
    role: text(row.role),
  };
}

export async function getStaffRoles(): Promise<StaffRole[]> {
  const res = await fetch(`${BASE}/staff/roles`);
  if (!res.ok) throw new Error(`staff roles failed ${res.status}`);

  const json = (await res.json()) as {
    rows?: Array<{ id?: unknown; name?: unknown; sort_order?: unknown }>;
  };

  return (json.rows || [])
    .map(row => ({
      id: text(row.id),
      name: text(row.name),
      sort_order: Number(row.sort_order) || 0,
    }))
    .filter(row => row.id && row.name);
}

type GetDirectoryOptions = {
  limit?: number;
  q?: string;
  role_id?: string;
  include_inactive?: boolean;
};

export async function getStaffDirectory(
  opts: GetDirectoryOptions = {},
): Promise<StaffLibraryItem[]> {
  const params = new URLSearchParams();
  params.set("limit", String(opts.limit ?? 200));
  if (opts.q) params.set("q", opts.q);
  if (opts.role_id) params.set("role_id", opts.role_id);
  if (opts.include_inactive) params.set("include_inactive", "true");

  const res = await fetch(`${BASE}/staff/directory?${params.toString()}`);
  if (!res.ok) throw new Error(`staff directory failed ${res.status}`);

  const json = (await res.json()) as {
    rows?: Array<Record<string, unknown>>;
  };

  return (json.rows || [])
    .map(row => {
      const base = parseStaffRow(row);
      return {
        ...base,
        used_count: Number(row.used_count) || 0,
        last_used_at: Number(row.last_used_at) || 0,
        created_at: numberOrNull(row.created_at) ?? undefined,
        updated_at: numberOrNull(row.updated_at) ?? undefined,
      };
    })
    .filter(row => row.name && row.role && row.role_id);
}

export async function createStaffDirectoryEntry(
  staff: StaffMember,
  actor?: { username?: string; name?: string; role?: string } | null,
): Promise<StaffLibraryItem> {
  const res = await fetch(`${BASE}/staff/directory`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      staff,
      actor: {
        username: actor?.username || "unknown",
        name: actor?.name || null,
        role: actor?.role || null,
      },
    }),
  });
  if (!res.ok) throw new Error(`staff directory create failed ${res.status}`);

  const json = (await res.json()) as {
    row?: Record<string, unknown>;
  };
  if (!json.row) throw new Error("staff directory create failed");

  const base = parseStaffRow(json.row);
  return {
    ...base,
    used_count: Number(json.row.used_count) || 0,
    last_used_at: Number(json.row.last_used_at) || 0,
    created_at: numberOrNull(json.row.created_at) ?? undefined,
    updated_at: numberOrNull(json.row.updated_at) ?? undefined,
  };
}

export async function updateStaffDirectoryEntry(
  entryId: number,
  staff: Partial<StaffMember> & { name?: string; role_id?: string; role?: string },
  actor?: { username?: string; name?: string; role?: string } | null,
): Promise<StaffLibraryItem> {
  const res = await fetch(`${BASE}/staff/directory/${entryId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      staff,
      actor: {
        username: actor?.username || "unknown",
        name: actor?.name || null,
        role: actor?.role || null,
      },
      is_active: staff.is_active,
    }),
  });
  if (!res.ok) throw new Error(`staff directory update failed ${res.status}`);

  const json = (await res.json()) as {
    row?: Record<string, unknown>;
  };
  if (!json.row) throw new Error("staff directory update failed");

  const base = parseStaffRow(json.row);
  return {
    ...base,
    used_count: Number(json.row.used_count) || 0,
    last_used_at: Number(json.row.last_used_at) || 0,
    created_at: numberOrNull(json.row.created_at) ?? undefined,
    updated_at: numberOrNull(json.row.updated_at) ?? undefined,
  };
}

export async function deactivateStaffDirectoryEntry(
  entryId: number,
): Promise<void> {
  const res = await fetch(`${BASE}/staff/directory/${entryId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`staff directory delete failed ${res.status}`);
}

export async function getCaseStaff(caseId: number): Promise<StaffMember[]> {
  const res = await fetch(`${BASE}/${caseId}/staff`);
  if (!res.ok) throw new Error(`staff list failed ${res.status}`);

  const json = (await res.json()) as {
    rows?: Array<Record<string, unknown>>;
  };

  return (json.rows || [])
    .map(parseStaffRow)
    .filter(row => row.name && row.role);
}

export async function saveCaseStaff(
  caseId: number,
  staff: StaffMember[],
  actor?: { username?: string; name?: string; role?: string } | null,
): Promise<StaffMember[]> {
  const payload = {
    staff,
    actor: {
      username: actor?.username || "unknown",
      name: actor?.name || null,
      role: actor?.role || null,
    },
  };

  const res = await fetch(`${BASE}/${caseId}/staff`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { error?: unknown };
      if (typeof body.error === "string" && body.error.trim()) {
        detail = `: ${body.error.trim()}`;
      }
    } catch {
      // ignore non-json error body
    }
    throw new Error(`staff save failed ${res.status}${detail}`);
  }

  const json = (await res.json()) as {
    rows?: Array<Record<string, unknown>>;
  };

  return (json.rows || [])
    .map(parseStaffRow)
    .filter(row => row.name && row.role);
}

export async function getStaffLibrary(limit = 50): Promise<StaffLibraryItem[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  const res = await fetch(`${BASE}/staff/library?${params.toString()}`);
  if (!res.ok) throw new Error(`staff library failed ${res.status}`);

  const json = (await res.json()) as {
    rows?: Array<Record<string, unknown>>;
  };

  return (json.rows || [])
    .map(row => {
      const base = parseStaffRow(row);
      return {
        ...base,
        used_count: Number(row.used_count) || 0,
        last_used_at: Number(row.last_used_at) || 0,
      };
    })
    .filter(row => row.name && row.role);
}
