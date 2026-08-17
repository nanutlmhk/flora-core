const path = require("path");
const { execFileSync } = require("child_process");
const Database = require(path.resolve(__dirname, "..", "backend", "node_modules", "better-sqlite3"));

function readArg(name, fallback = "") {
  const prefix = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length).trim();
  }
  return fallback;
}

const excelPath = path.resolve(
  readArg("excel", path.resolve(__dirname, "..", "docs", "Anes CU-staffs V3 mar-2569.xlsx")),
);
const dbPath = path.resolve(
  readArg("db", path.resolve(__dirname, "..", "deploy-artifacts", "flora.db")),
);

function runPowerShell(command) {
  return execFileSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
    { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
  );
}

function loadExcelRows(xlsxPath) {
  const ps = `
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$wb = $excel.Workbooks.Open('${xlsxPath.replace(/'/g, "''")}')
$ws = $wb.Worksheets.Item(1)
$rows = $ws.UsedRange.Rows.Count
$list = @()
for ($r=2; $r -le $rows; $r++) {
  $thFirst = [string]$ws.Cells.Item($r,2).Text
  $thLast = [string]$ws.Cells.Item($r,3).Text
  $enFirst = [string]$ws.Cells.Item($r,4).Text
  $enLast = [string]$ws.Cells.Item($r,5).Text
  $hospitalId = [string]$ws.Cells.Item($r,6).Text
  $personalRole = [string]$ws.Cells.Item($r,7).Text
  $email = [string]$ws.Cells.Item($r,8).Text
  $innovianId = [string]$ws.Cells.Item($r,10).Text
  if (($thFirst + $thLast + $enFirst + $enLast + $hospitalId + $personalRole + $email + $innovianId).Trim() -eq '') { continue }
  $list += [pscustomobject]@{
    rowNumber = $r
    thFirstName = $thFirst.Trim()
    thLastName = $thLast.Trim()
    enFirstName = $enFirst.Trim()
    enLastName = $enLast.Trim()
    hospitalId = $hospitalId.Trim()
    personalRole = $personalRole.Trim()
    email = $email.Trim()
    innovianId = $innovianId.Trim()
  }
}
$wb.Close($false)
$excel.Quit()
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($ws) | Out-Null
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($wb) | Out-Null
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
$list | ConvertTo-Json -Compress -Depth 4
`;
  const output = runPowerShell(ps).trim();
  if (!output) return [];
  const parsed = JSON.parse(output);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeAuthToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function buildStaffUsernameCandidates(firstName, lastName) {
  const first = normalizeAuthToken(firstName);
  const last = normalizeAuthToken(lastName);
  if (!first || !last) return [];
  const candidates = [];
  const maxLastChars = Math.min(last.length, 6);
  for (let count = 1; count <= maxLastChars; count += 1) {
    candidates.push(`${first}.${last.slice(0, count)}`);
  }
  return candidates;
}

function createPasswordRecord(password) {
  const crypto = require("crypto");
  const saltHex = crypto.randomBytes(16).toString("hex");
  const hashHex = crypto
    .scryptSync(String(password), Buffer.from(saltHex, "hex"), 64)
    .toString("hex");
  return { saltHex, hashHex };
}

function deriveRole(personalRole) {
  const text = normalizeText(personalRole).toLowerCase();
  if (text.includes("nurse")) {
    return { roleId: "nurseAnesthetist", roleLabel: "Nurse Anesthetist", authRole: "nurse" };
  }
  if (text.includes("resident")) {
    return { roleId: "anesthetistResident", roleLabel: "Anesthetist Resident", authRole: "resident" };
  }
  return { roleId: "anesthetist", roleLabel: "Anesthetist", authRole: "anesthetist" };
}

function buildStaffName(row) {
  const en = `${normalizeText(row.enFirstName)} ${normalizeText(row.enLastName)}`.trim();
  if (en) return en;
  const th = `${normalizeText(row.thFirstName)} ${normalizeText(row.thLastName)}`.trim();
  return th;
}

function main() {
  const rows = loadExcelRows(excelPath)
    .map((row) => ({
      rowNumber: Number(row.rowNumber || 0),
      thFirstName: normalizeText(row.thFirstName),
      thLastName: normalizeText(row.thLastName),
      enFirstName: normalizeText(row.enFirstName),
      enLastName: normalizeText(row.enLastName),
      hospitalId: normalizeText(row.hospitalId),
      personalRole: normalizeText(row.personalRole),
      email: normalizeText(row.email),
      innovianId: normalizeText(row.innovianId),
    }))
    .filter((row) => buildStaffName(row) || row.hospitalId);

  if (rows.length === 0) {
    throw new Error(`No usable staff rows found in ${excelPath}`);
  }

  const duplicateHospitalIds = new Map();
  for (const row of rows) {
    if (!row.hospitalId) continue;
    const list = duplicateHospitalIds.get(row.hospitalId) || [];
    list.push(row);
    duplicateHospitalIds.set(row.hospitalId, list);
  }
  const conflictingHospitalIds = Array.from(duplicateHospitalIds.entries())
    .filter(([, list]) => {
      if (list.length < 2) return false;
      const uniqueNames = new Set(list.map((row) => buildStaffName(row)).filter(Boolean));
      return uniqueNames.size > 1;
    });
  if (conflictingHospitalIds.length > 0) {
    const detail = conflictingHospitalIds
      .map(([hospitalId, list]) => {
        const people = list
          .map((row) => `row ${row.rowNumber || "?"}: ${buildStaffName(row) || "(blank name)"}`)
          .join("; ");
        return `${hospitalId} -> ${people}`;
      })
      .join(" | ");
    throw new Error(`Duplicate hospital_id conflict in Excel: ${detail}`);
  }

  const db = new Database(dbPath);
  const now = Date.now();
  const DEFAULT_STAFF_AUTH_PASSWORD = "aidas";

  const selectStaffByHospitalId = db.prepare(
    `SELECT * FROM staff_directory WHERE hospital_id = ? LIMIT 1`,
  );
  const selectStaffByName = db.prepare(
    `SELECT * FROM staff_directory WHERE staff_name = ? LIMIT 1`,
  );
  const insertStaff = db.prepare(
    `INSERT INTO staff_directory (
        hospital_id, personal_id, email,
        th_first_name, th_last_name, en_first_name, en_last_name,
        innovian_id, staff_role_id, entry_year, is_active,
        staff_name, staff_role, used_count, last_used_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
  );
  const updateStaff = db.prepare(
    `UPDATE staff_directory
     SET hospital_id = ?,
         personal_id = ?,
         email = ?,
         th_first_name = ?,
         th_last_name = ?,
         en_first_name = ?,
         en_last_name = ?,
         innovian_id = ?,
         staff_role_id = ?,
         staff_role = ?,
         is_active = 1,
         updated_at = ?
     WHERE id = ?`,
  );

  const selectAuthByHospitalId = db.prepare(
    `SELECT * FROM auth_user WHERE hospital_id = ? LIMIT 1`,
  );
  const selectAuthByUsername = db.prepare(
    `SELECT * FROM auth_user WHERE lower(username) = lower(?) LIMIT 1`,
  );
  const insertAuth = db.prepare(
    `INSERT INTO auth_user (
        username, hospital_id, auth_source, password_salt, password_hash, name, role, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  );
  const updateAuthProfile = db.prepare(
    `UPDATE auth_user
     SET username = ?, hospital_id = ?, auth_source = ?, name = ?, role = ?, is_active = ?, updated_at = ?
     WHERE id = ?`,
  );

  const allAuthRows = db.prepare(
    `SELECT id, username, hospital_id, auth_source, role FROM auth_user`,
  ).all();
  const usernameOwners = new Map();
  for (const row of allAuthRows) {
    const username = normalizeText(row.username);
    if (!username) continue;
    usernameOwners.set(username.toLowerCase(), {
      hospitalId: normalizeText(row.hospital_id),
      authSource: normalizeText(row.auth_source),
    });
  }

  let staffInserted = 0;
  let staffUpdated = 0;
  let authInserted = 0;
  let authUpdated = 0;

  const tx = db.transaction(() => {
    for (const row of rows) {
      const staffName = buildStaffName(row);
      const hospitalId = row.hospitalId;
      if (!staffName && !hospitalId) continue;

      const { roleId, roleLabel, authRole } = deriveRole(row.personalRole);
      const existingStaff =
        (hospitalId && selectStaffByHospitalId.get(hospitalId)) || selectStaffByName.get(staffName);

      if (!existingStaff) {
        insertStaff.run(
          hospitalId || null,
          hospitalId || null,
          row.email || null,
          row.thFirstName || null,
          row.thLastName || null,
          row.enFirstName || null,
          row.enLastName || null,
          row.innovianId || null,
          roleId,
          null,
          staffName,
          roleLabel,
          0,
          now,
          now,
          now,
        );
        staffInserted += 1;
      } else {
        updateStaff.run(
          hospitalId || existingStaff.hospital_id || existingStaff.personal_id || null,
          hospitalId || existingStaff.personal_id || existingStaff.hospital_id || null,
          row.email || existingStaff.email || null,
          row.thFirstName || existingStaff.th_first_name || null,
          row.thLastName || existingStaff.th_last_name || null,
          row.enFirstName || existingStaff.en_first_name || null,
          row.enLastName || existingStaff.en_last_name || null,
          row.innovianId || existingStaff.innovian_id || null,
          roleId || existingStaff.staff_role_id || null,
          roleLabel || existingStaff.staff_role,
          now,
          existingStaff.id,
        );
        staffUpdated += 1;
      }

      if (!hospitalId) continue;

      const existingAuth = selectAuthByHospitalId.get(hospitalId);
      const candidates = buildStaffUsernameCandidates(row.enFirstName, row.enLastName);
      let selectedUsername = existingAuth ? normalizeText(existingAuth.username) : "";
      if (!selectedUsername) {
        for (const candidate of candidates) {
          const owner = usernameOwners.get(candidate.toLowerCase());
          if (!owner || owner.hospitalId === hospitalId) {
            selectedUsername = candidate;
            break;
          }
        }
      }
      if (!selectedUsername) {
        const fallbackBase = candidates[candidates.length - 1] || normalizeAuthToken(staffName) || `staff${hospitalId}`;
        let suffix = 2;
        selectedUsername = fallbackBase;
        while (usernameOwners.has(selectedUsername.toLowerCase())) {
          selectedUsername = `${fallbackBase}${suffix}`;
          suffix += 1;
        }
      }

      if (!existingAuth) {
        const byUsername = selectAuthByUsername.get(selectedUsername);
        const target = byUsername && normalizeText(byUsername.hospital_id) !== hospitalId ? null : byUsername;
        if (!target) {
          const passwordRecord = createPasswordRecord(DEFAULT_STAFF_AUTH_PASSWORD);
          insertAuth.run(
            selectedUsername,
            hospitalId,
            "staff",
            passwordRecord.saltHex,
            passwordRecord.hashHex,
            staffName || selectedUsername,
            authRole,
            now,
            now,
          );
          authInserted += 1;
          usernameOwners.set(selectedUsername.toLowerCase(), { hospitalId, authSource: "staff" });
        } else {
          const preservedRole =
            normalizeText(target.role).toLowerCase() === "admin" ? "admin" : authRole;
          updateAuthProfile.run(
            selectedUsername,
            hospitalId,
            "staff",
            staffName || selectedUsername,
            preservedRole,
            1,
            now,
            target.id,
          );
          authUpdated += 1;
          usernameOwners.set(selectedUsername.toLowerCase(), { hospitalId, authSource: "staff" });
        }
      } else {
        const preservedRole =
          normalizeText(existingAuth.role).toLowerCase() === "admin" ? "admin" : authRole;
        updateAuthProfile.run(
          selectedUsername,
          hospitalId,
          "staff",
          staffName || selectedUsername,
          preservedRole,
          1,
          now,
          existingAuth.id,
        );
        authUpdated += 1;
        usernameOwners.set(selectedUsername.toLowerCase(), { hospitalId, authSource: "staff" });
      }
    }
  });

  try {
    tx();
  } finally {
    db.close();
  }

  console.log(`[STAFF-SYNC] excel : ${excelPath}`);
  console.log(`[STAFF-SYNC] db    : ${dbPath}`);
  console.log(`[STAFF-SYNC] rows  : ${rows.length}`);
  console.log(`[STAFF-SYNC] staff inserted=${staffInserted} updated=${staffUpdated}`);
  console.log(`[STAFF-SYNC] auth  inserted=${authInserted} updated=${authUpdated}`);
}

main();
