const fs = require("fs");
const path = require("path");
const Database = require(path.resolve(__dirname, "..", "backend", "node_modules", "better-sqlite3"));

function readArg(name, fallback = "") {
  const prefix = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length).trim();
  }
  return fallback;
}

function resolvePath(value) {
  return path.resolve(String(value || "").trim());
}

const sourcePath = resolvePath(
  readArg("source", path.resolve(__dirname, "..", "deploy-artifacts", "flora.db")),
);
const targetPath = resolvePath(
  readArg("target", "C:\\porjai\\data\\flora.db"),
);

if (!fs.existsSync(sourcePath)) {
  throw new Error(`Source DB not found: ${sourcePath}`);
}
if (!fs.existsSync(targetPath)) {
  throw new Error(`Target DB not found: ${targetPath}`);
}

const sourceDb = new Database(sourcePath, { readonly: true });
const targetDb = new Database(targetPath);
targetDb.pragma("journal_mode = WAL");
targetDb.pragma("busy_timeout = 15000");
targetDb.pragma("foreign_keys = ON");

const selectSourceStaff = sourceDb.prepare(`
  SELECT
    hospital_id,
    personal_id,
    email,
    th_first_name,
    th_last_name,
    en_first_name,
    en_last_name,
    innovian_id,
    staff_role_id,
    entry_year,
    is_active,
    staff_name,
    staff_role,
    used_count,
    last_used_at,
    created_at,
    updated_at
  FROM staff_directory
  ORDER BY id
`);

const selectSourceStaffAuth = sourceDb.prepare(`
  SELECT
    username,
    hospital_id,
    auth_source,
    password_salt,
    password_hash,
    name,
    role,
    theme_mode,
    theme_color,
    is_active,
    created_at,
    updated_at,
    last_login_at
  FROM auth_user
  WHERE auth_source = 'staff'
  ORDER BY id
`);

const selectTargetStaffByHospitalId = targetDb.prepare(
  `SELECT * FROM staff_directory WHERE hospital_id = ? LIMIT 1`,
);
const selectTargetStaffByNameRole = targetDb.prepare(
  `SELECT * FROM staff_directory WHERE lower(staff_name) = lower(?) AND lower(staff_role) = lower(?) LIMIT 1`,
);
const insertTargetStaff = targetDb.prepare(`
  INSERT INTO staff_directory (
    hospital_id, personal_id, email,
    th_first_name, th_last_name, en_first_name, en_last_name,
    innovian_id, staff_role_id, entry_year, is_active,
    staff_name, staff_role, used_count, last_used_at, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const updateTargetStaff = targetDb.prepare(`
  UPDATE staff_directory
  SET hospital_id = ?,
      personal_id = ?,
      email = ?,
      th_first_name = ?,
      th_last_name = ?,
      en_first_name = ?,
      en_last_name = ?,
      innovian_id = ?,
      staff_role_id = ?,
      entry_year = ?,
      is_active = ?,
      staff_name = ?,
      staff_role = ?,
      used_count = ?,
      last_used_at = ?,
      updated_at = ?
  WHERE id = ?
`);
const deleteTargetStaffById = targetDb.prepare(
  `DELETE FROM staff_directory WHERE id = ?`,
);

const selectTargetAuthByHospitalId = targetDb.prepare(
  `SELECT * FROM auth_user WHERE hospital_id = ? LIMIT 1`,
);
const selectTargetAuthByUsername = targetDb.prepare(
  `SELECT * FROM auth_user WHERE lower(username) = lower(?) LIMIT 1`,
);
const insertTargetAuth = targetDb.prepare(`
  INSERT INTO auth_user (
    username, hospital_id, auth_source, password_salt, password_hash,
    name, role, theme_mode, theme_color, is_active, created_at, updated_at, last_login_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const updateTargetAuthPreserveSecret = targetDb.prepare(`
  UPDATE auth_user
  SET username = ?,
      hospital_id = ?,
      auth_source = ?,
      name = ?,
      role = ?,
      theme_mode = ?,
      theme_color = ?,
      is_active = ?,
      updated_at = ?,
      last_login_at = ?
  WHERE id = ?
`);
const updateTargetAuthFull = targetDb.prepare(`
  UPDATE auth_user
  SET username = ?,
      hospital_id = ?,
      auth_source = ?,
      password_salt = ?,
      password_hash = ?,
      name = ?,
      role = ?,
      theme_mode = ?,
      theme_color = ?,
      is_active = ?,
      updated_at = ?,
      last_login_at = ?
  WHERE id = ?
`);

function normalizeText(value) {
  return String(value || "").trim();
}

function syncStaffDirectory() {
  const rows = selectSourceStaff.all();
  let inserted = 0;
  let updated = 0;

  for (const row of rows) {
    const hospitalId = normalizeText(row.hospital_id);
    const staffName = normalizeText(row.staff_name);
    const roleId = normalizeText(row.staff_role_id);
    const roleLabel = normalizeText(row.staff_role);
    if (!hospitalId && (!staffName || !roleId)) continue;

    const existing =
      (hospitalId ? selectTargetStaffByHospitalId.get(hospitalId) : null) ||
      (staffName && roleLabel ? selectTargetStaffByNameRole.get(staffName, roleLabel) : null);

    if (!existing) {
      try {
        insertTargetStaff.run(
          row.hospital_id || null,
          row.personal_id || null,
          row.email || null,
          row.th_first_name || null,
          row.th_last_name || null,
          row.en_first_name || null,
          row.en_last_name || null,
          row.innovian_id || null,
          row.staff_role_id || null,
          row.entry_year || null,
          Number(row.is_active || 0) === 1 ? 1 : 0,
          row.staff_name || null,
          row.staff_role || null,
          Number(row.used_count || 0),
          row.last_used_at || null,
          row.created_at || Date.now(),
          Date.now(),
        );
        inserted += 1;
        continue;
      } catch (err) {
        const conflictByNameRole =
          staffName && roleLabel ? selectTargetStaffByNameRole.get(staffName, roleLabel) : null;
        if (!conflictByNameRole) throw err;

        updateTargetStaff.run(
          row.hospital_id || conflictByNameRole.hospital_id || null,
          row.personal_id || conflictByNameRole.personal_id || null,
          row.email || conflictByNameRole.email || null,
          row.th_first_name || conflictByNameRole.th_first_name || null,
          row.th_last_name || conflictByNameRole.th_last_name || null,
          row.en_first_name || conflictByNameRole.en_first_name || null,
          row.en_last_name || conflictByNameRole.en_last_name || null,
          row.innovian_id || conflictByNameRole.innovian_id || null,
          row.staff_role_id || conflictByNameRole.staff_role_id || null,
          row.entry_year || conflictByNameRole.entry_year || null,
          Number(row.is_active || 0) === 1 ? 1 : 0,
          row.staff_name || conflictByNameRole.staff_name || null,
          row.staff_role || conflictByNameRole.staff_role || null,
          Math.max(Number(conflictByNameRole.used_count || 0), Number(row.used_count || 0)),
          conflictByNameRole.last_used_at || row.last_used_at || null,
          Date.now(),
          conflictByNameRole.id,
        );
        updated += 1;
        continue;
      }
    }

    try {
      updateTargetStaff.run(
        row.hospital_id || existing.hospital_id || null,
        row.personal_id || existing.personal_id || null,
        row.email || existing.email || null,
        row.th_first_name || existing.th_first_name || null,
        row.th_last_name || existing.th_last_name || null,
        row.en_first_name || existing.en_first_name || null,
        row.en_last_name || existing.en_last_name || null,
        row.innovian_id || existing.innovian_id || null,
        row.staff_role_id || existing.staff_role_id || null,
        row.entry_year || existing.entry_year || null,
        Number(row.is_active || 0) === 1 ? 1 : 0,
        row.staff_name || existing.staff_name || null,
        row.staff_role || existing.staff_role || null,
        Math.max(Number(existing.used_count || 0), Number(row.used_count || 0)),
        existing.last_used_at || row.last_used_at || null,
        Date.now(),
        existing.id,
      );
    } catch (err) {
      const targetName = row.staff_name || existing.staff_name || null;
      const targetRole = row.staff_role || existing.staff_role || null;
      const conflictByNameRole =
        targetName && targetRole ? selectTargetStaffByNameRole.get(targetName, targetRole) : null;
      if (!conflictByNameRole || Number(conflictByNameRole.id) === Number(existing.id)) {
        throw err;
      }

      updateTargetStaff.run(
        row.hospital_id || existing.hospital_id || conflictByNameRole.hospital_id || null,
        row.personal_id || existing.personal_id || conflictByNameRole.personal_id || null,
        row.email || existing.email || conflictByNameRole.email || null,
        row.th_first_name || existing.th_first_name || conflictByNameRole.th_first_name || null,
        row.th_last_name || existing.th_last_name || conflictByNameRole.th_last_name || null,
        row.en_first_name || existing.en_first_name || conflictByNameRole.en_first_name || null,
        row.en_last_name || existing.en_last_name || conflictByNameRole.en_last_name || null,
        row.innovian_id || existing.innovian_id || conflictByNameRole.innovian_id || null,
        row.staff_role_id || existing.staff_role_id || conflictByNameRole.staff_role_id || null,
        row.entry_year || existing.entry_year || conflictByNameRole.entry_year || null,
        Number(row.is_active || 0) === 1 ? 1 : 0,
        targetName,
        targetRole,
        Math.max(
          Number(existing.used_count || 0),
          Number(conflictByNameRole.used_count || 0),
          Number(row.used_count || 0),
        ),
        conflictByNameRole.last_used_at || existing.last_used_at || row.last_used_at || null,
        Date.now(),
        conflictByNameRole.id,
      );
      deleteTargetStaffById.run(existing.id);
    }
    updated += 1;
  }

  return { inserted, updated, total: rows.length };
}

function syncStaffAuthUsers() {
  const rows = selectSourceStaffAuth.all();
  let inserted = 0;
  let updated = 0;

  for (const row of rows) {
    const hospitalId = normalizeText(row.hospital_id);
    const username = normalizeText(row.username);
    if (!hospitalId || !username) continue;

    const existing =
      selectTargetAuthByHospitalId.get(hospitalId) ||
      selectTargetAuthByUsername.get(username);

    if (!existing) {
      insertTargetAuth.run(
        row.username,
        row.hospital_id,
        "staff",
        row.password_salt,
        row.password_hash,
        row.name,
        row.role,
        row.theme_mode || null,
        row.theme_color || null,
        Number(row.is_active || 0) === 1 ? 1 : 0,
        row.created_at || Date.now(),
        Date.now(),
        row.last_login_at || null,
      );
      inserted += 1;
      continue;
    }

    const preserveAdmin = normalizeText(existing.role).toLowerCase() === "admin";
    const preservePassword = true;
    if (preservePassword) {
      updateTargetAuthPreserveSecret.run(
        row.username,
        row.hospital_id,
        "staff",
        row.name,
        preserveAdmin ? "admin" : row.role,
        existing.theme_mode || row.theme_mode || null,
        existing.theme_color || row.theme_color || null,
        Number(row.is_active || 0) === 1 ? 1 : 0,
        Date.now(),
        existing.last_login_at || row.last_login_at || null,
        existing.id,
      );
    } else {
      updateTargetAuthFull.run(
        row.username,
        row.hospital_id,
        "staff",
        row.password_salt,
        row.password_hash,
        row.name,
        preserveAdmin ? "admin" : row.role,
        existing.theme_mode || row.theme_mode || null,
        existing.theme_color || row.theme_color || null,
        Number(row.is_active || 0) === 1 ? 1 : 0,
        Date.now(),
        existing.last_login_at || row.last_login_at || null,
        existing.id,
      );
    }
    updated += 1;
  }

  return { inserted, updated, total: rows.length };
}

const targetBackupPath = `${targetPath}.bak-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}`;
fs.copyFileSync(targetPath, targetBackupPath);

try {
  const tx = targetDb.transaction(() => {
    const staff = syncStaffDirectory();
    const auth = syncStaffAuthUsers();
    return { staff, auth };
  });

  const result = tx();
  console.log(JSON.stringify({
    ok: true,
    sourcePath,
    targetPath,
    targetBackupPath,
    ...result,
  }, null, 2));
} finally {
  sourceDb.close();
  targetDb.close();
}
