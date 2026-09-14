const path = require("path");
const { execFileSync } = require("child_process");
const crypto = require("crypto");
const Database = require(path.resolve(__dirname, "..", "backend", "node_modules", "better-sqlite3"));

function runPowerShell(command) {
  return execFileSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
    { encoding: "utf8", maxBuffer: 100 * 1024 * 1024 },
  );
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeToken(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeNameKey(value) {
  return normalizeText(value).toLowerCase().replace(/[^a-z]/g, "");
}

function buildDisplayName(row) {
  const english = `${normalizeText(row.efname)} ${normalizeText(row.elname)}`.trim();
  if (english) return english;
  return normalizeText(row.dspname);
}

function buildUsernameCandidates(firstName, lastName) {
  const first = normalizeText(firstName).toLowerCase().replace(/[^a-z0-9]+/g, "");
  const last = normalizeText(lastName).toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!first || !last) return [];
  const candidates = [];
  const maxLastChars = Math.min(last.length, 8);
  for (let count = 1; count <= maxLastChars; count += 1) {
    candidates.push(`${first}.${last.slice(0, count)}`);
  }
  return candidates;
}

function createPasswordRecord(password) {
  const saltHex = crypto.randomBytes(16).toString("hex");
  const hashHex = crypto
    .scryptSync(String(password), Buffer.from(saltHex, "hex"), 64)
    .toString("hex");
  return { saltHex, hashHex };
}

function loadDoctorRows(xlsxPath) {
  const ps = `
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$wb = $null
$ws = $null
$used = $null
try {
  $wb = $excel.Workbooks.Open('${xlsxPath.replace(/'/g, "''")}')
  $ws = $wb.Worksheets.Item(1)
  $used = $ws.UsedRange
  $rowCount = $used.Rows.Count
  $colCount = $used.Columns.Count
  $headers = @()
  for ($c = 1; $c -le $colCount; $c++) {
    $headers += [string]$used.Item(1, $c).Text
  }
  $rows = @()
  for ($r = 2; $r -le $rowCount; $r++) {
    $obj = [ordered]@{}
    $nonEmpty = $false
    for ($c = 1; $c -le $colCount; $c++) {
      $key = if ($headers[$c-1]) { [string]$headers[$c-1] } else { "COL_$c" }
      $val = [string]$used.Item($r, $c).Text
      if ($val.Trim() -ne '') { $nonEmpty = $true }
      $obj[$key] = $val.Trim()
    }
    if ($nonEmpty) {
      $rows += [pscustomobject]$obj
    }
  }
  $rows | ConvertTo-Json -Compress -Depth 4
}
finally {
  if ($wb) { $wb.Close($false) }
  $excel.Quit()
  if ($used) { [void][System.Runtime.Interopservices.Marshal]::ReleaseComObject($used) }
  if ($ws) { [void][System.Runtime.Interopservices.Marshal]::ReleaseComObject($ws) }
  if ($wb) { [void][System.Runtime.Interopservices.Marshal]::ReleaseComObject($wb) }
  [void][System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel)
  [gc]::Collect()
  [gc]::WaitForPendingFinalizers()
}
`;
  const output = runPowerShell(ps).trim();
  if (!output) return [];
  const parsed = JSON.parse(output);
  return (Array.isArray(parsed) ? parsed : [parsed]).map((row) => ({
    hcode: normalizeText(row.hcode),
    staff: normalizeText(row.staff),
    pertype: normalizeText(row.pertype),
    pertypenm: normalizeText(row.pertypenm),
    dspname: normalizeText(row.dspname),
    efname: normalizeText(row.efname),
    elname: normalizeText(row.elname),
    lcno: normalizeText(row.lcno),
    dcttype: normalizeText(row.dcttype),
    name: normalizeText(row.name),
    divcd: normalizeText(row.divcd),
    divnm: normalizeText(row.divnm),
    poscd: normalizeText(row.poscd),
    posnm: normalizeText(row.posnm),
    userid: normalizeText(row.userid),
    userst: normalizeText(row.userst),
  })).filter((row) => row.hcode && buildDisplayName(row));
}

function dedupeByHospitalId(rows) {
  const seen = new Map();
  for (const row of rows) {
    seen.set(row.hcode, row);
  }
  return Array.from(seen.values());
}

function deriveAnesRoles(row) {
  const pertypeName = normalizeText(row.pertypenm);
  const posName = normalizeText(row.posnm);
  const userId = normalizeText(row.userid).toLowerCase();
  const licenseNo = normalizeText(row.lcno);
  const doctorLike =
    normalizeText(row.dcttype) === "1" ||
    licenseNo !== "" ||
    pertypeName.includes("อาจารย์แพทย์") ||
    posName.includes("นายแพทย์") ||
    userId.startsWith("d");

  if (doctorLike) {
    return {
      staffRoleId: "anesthetist",
      staffRoleLabel: "Anesthetist",
      authRole: "anesthetist",
    };
  }

  if (posName.includes("ผู้ช่วยพยาบาล") || posName.includes("เจ้าหน้าที่พยาบาล")) {
    return {
      staffRoleId: "assistant",
      staffRoleLabel: "Assistant",
      authRole: "nurse",
    };
  }

  if (posName.includes("พยาบาล") || userId.startsWith("ns")) {
    return {
      staffRoleId: "nurseAnesthetist",
      staffRoleLabel: "Nurse anesthetist",
      authRole: "nurse",
    };
  }

  return {
    staffRoleId: "assistant",
    staffRoleLabel: "Assistant",
    authRole: "nurse",
  };
}

function syncDb(dbPath, anesRows, otherRows) {
  const db = new Database(dbPath);
  const now = Date.now();
  const defaultPassword = "flora";

  const selectStaffByHospitalId = db.prepare(`SELECT * FROM staff_directory WHERE hospital_id = ? LIMIT 1`);
  const selectStaffByName = db.prepare(`SELECT * FROM staff_directory WHERE lower(staff_name) = lower(?) LIMIT 1`);
  const insertStaff = db.prepare(`
    INSERT INTO staff_directory (
      hospital_id, personal_id, email,
      th_first_name, th_last_name, en_first_name, en_last_name,
      innovian_id, staff_role_id, entry_year, is_active,
      staff_name, staff_role, used_count, last_used_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateStaff = db.prepare(`
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
           updated_at = ?
     WHERE id = ?
  `);

  const selectAuthByHospitalId = db.prepare(`SELECT * FROM auth_user WHERE hospital_id = ? LIMIT 1`);
  const selectAuthByUsername = db.prepare(`SELECT * FROM auth_user WHERE lower(username) = lower(?) LIMIT 1`);
  const selectAuthByName = db.prepare(`SELECT * FROM auth_user WHERE lower(name) = lower(?) LIMIT 1`);
  const insertAuth = db.prepare(`
    INSERT INTO auth_user (
      username, hospital_id, auth_source, password_salt, password_hash, name, role, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateAuth = db.prepare(`
    UPDATE auth_user
       SET username = ?,
           hospital_id = ?,
           auth_source = ?,
           name = ?,
           role = ?,
           is_active = ?,
           updated_at = ?
     WHERE id = ?
  `);

  const allAuthRows = db.prepare(`SELECT id, username, hospital_id FROM auth_user`).all();
  const usernameOwners = new Map();
  for (const row of allAuthRows) {
    const username = normalizeText(row.username);
    if (username) usernameOwners.set(username.toLowerCase(), normalizeText(row.hospital_id));
  }

  const stats = {
    preFixedStaff: 0,
    preFixedUsers: 0,
    anesStaffInserted: 0,
    anesStaffUpdated: 0,
    anesUserInserted: 0,
    anesUserUpdated: 0,
    otherStaffInserted: 0,
    otherStaffUpdated: 0,
  };

  const tx = db.transaction(() => {
    // Known conflict correction from HIS source of truth.
    const preStaff = db.prepare(`
      UPDATE staff_directory
         SET hospital_id = '7279200',
             personal_id = CASE
               WHEN trim(COALESCE(personal_id, '')) = '' OR personal_id = '7278500' THEN '7279200'
               ELSE personal_id
             END,
             staff_name = 'Kornkamon Yuwapattanawong',
             updated_at = ?
       WHERE lower(staff_name) LIKE 'kornkamon%'
         AND hospital_id = '7278500'
    `).run(now);
    const preUser = db.prepare(`
      UPDATE auth_user
         SET hospital_id = '7279200',
             name = 'Kornkamon Yuwapattanawong',
             updated_at = ?
       WHERE lower(name) LIKE 'kornkamon%'
         AND hospital_id = '7278500'
    `).run(now);
    stats.preFixedStaff = preStaff.changes;
    stats.preFixedUsers = preUser.changes;

    const upsertStaffOnly = (row, roleId, roleLabel) => {
      const displayName = buildDisplayName(row);
      const existing =
        (row.hcode && selectStaffByHospitalId.get(row.hcode)) ||
        selectStaffByName.get(displayName);
      const isActive = row.userst === "0" ? 0 : 1;
      const personalId = row.staff || row.hcode || null;
      const innovianId = null;

      if (!existing) {
        insertStaff.run(
          row.hcode || null,
          personalId,
          null,
          null,
          null,
          row.efname || null,
          row.elname || null,
          innovianId,
          roleId,
          null,
          isActive,
          displayName,
          roleLabel,
          0,
          now,
          now,
          now,
        );
        return "inserted";
      }

      updateStaff.run(
        row.hcode || existing.hospital_id || null,
        personalId || existing.personal_id || null,
        existing.email || null,
        existing.th_first_name || null,
        existing.th_last_name || null,
        row.efname || existing.en_first_name || null,
        row.elname || existing.en_last_name || null,
        existing.innovian_id || innovianId,
        roleId || existing.staff_role_id || null,
        existing.entry_year || null,
        isActive,
        displayName || existing.staff_name || null,
        roleLabel || existing.staff_role || null,
        now,
        existing.id,
      );
      return "updated";
    };

    for (const row of anesRows) {
      const anesRole = deriveAnesRoles(row);
      const staffResult = upsertStaffOnly(row, anesRole.staffRoleId, anesRole.staffRoleLabel);
      if (staffResult === "inserted") stats.anesStaffInserted += 1;
      else stats.anesStaffUpdated += 1;

      const displayName = buildDisplayName(row);
      const isActive = row.userst === "0" ? 0 : 1;
      const existingAuth =
        (row.hcode && selectAuthByHospitalId.get(row.hcode)) ||
        selectAuthByName.get(displayName);

      let selectedUsername = existingAuth ? normalizeText(existingAuth.username) : "";
      if (!selectedUsername) {
        for (const candidate of buildUsernameCandidates(row.efname, row.elname)) {
          const ownerHospitalId = usernameOwners.get(candidate.toLowerCase());
          if (!ownerHospitalId || ownerHospitalId === row.hcode) {
            selectedUsername = candidate;
            break;
          }
        }
      }
      if (!selectedUsername) {
        const fallbackBase =
          buildUsernameCandidates(row.efname, row.elname).slice(-1)[0] ||
          normalizeText(row.userid).toLowerCase() ||
          `staff${row.hcode}`;
        let username = fallbackBase;
        let suffix = 2;
        while (usernameOwners.has(username.toLowerCase()) && usernameOwners.get(username.toLowerCase()) !== row.hcode) {
          username = `${fallbackBase}${suffix}`;
          suffix += 1;
        }
        selectedUsername = username;
      }

      if (!existingAuth) {
        const byUsername = selectAuthByUsername.get(selectedUsername);
        if (!byUsername) {
          const pw = createPasswordRecord(defaultPassword);
          insertAuth.run(
            selectedUsername,
            row.hcode,
            "staff",
            pw.saltHex,
            pw.hashHex,
            displayName,
            anesRole.authRole,
            isActive,
            now,
            now,
          );
          stats.anesUserInserted += 1;
        } else {
          updateAuth.run(
            selectedUsername,
            row.hcode,
            "staff",
            displayName,
            normalizeToken(byUsername.role) === "admin" ? "admin" : anesRole.authRole,
            isActive,
            now,
            byUsername.id,
          );
          stats.anesUserUpdated += 1;
        }
      } else {
        updateAuth.run(
          selectedUsername,
          row.hcode,
          "staff",
          displayName,
          normalizeToken(existingAuth.role) === "admin" ? "admin" : anesRole.authRole,
          isActive,
          now,
          existingAuth.id,
        );
        stats.anesUserUpdated += 1;
      }
      usernameOwners.set(selectedUsername.toLowerCase(), row.hcode);
    }

    for (const row of otherRows) {
      const staffResult = upsertStaffOnly(row, "surgeon", "Surgeon");
      if (staffResult === "inserted") stats.otherStaffInserted += 1;
      else stats.otherStaffUpdated += 1;
    }
  });

  tx();
  db.close();
  return stats;
}

function main() {
  const anesPath = path.resolve(__dirname, "..", "docs", "doctor_ANES_25690506 (1).xlsx");
  const otherPath = path.resolve(__dirname, "..", "docs", "doctor_other_25690506 (1).xlsx");
  const dbPaths = [
    path.resolve(__dirname, "..", "data", "flora.db"),
    path.resolve(__dirname, "..", "deploy-artifacts", "flora.db"),
    path.resolve(__dirname, "..", "deploy-artifacts", "client-release-1.2.1", "flora.db"),
    path.resolve("C:\\porjai\\data\\flora.db"),
  ];

  const anesRows = dedupeByHospitalId(loadDoctorRows(anesPath));
  const otherRows = dedupeByHospitalId(loadDoctorRows(otherPath));

  console.log(`[HIS-DOCTOR-SYNC] ANES rows : ${anesRows.length}`);
  console.log(`[HIS-DOCTOR-SYNC] OTHER rows: ${otherRows.length}`);

  for (const dbPath of dbPaths) {
    const stats = syncDb(dbPath, anesRows, otherRows);
    console.log(`[HIS-DOCTOR-SYNC] db: ${dbPath}`);
    console.log(JSON.stringify(stats));
  }
}

main();
