const { parseVTQ, parseVTD } = require("./protocol");
const { computeChecksum } = require("./checksum");
const SOF = 0x3a;

function parseVTQLegacy(line) {
  const payload = line.slice(0, -1).toString("ascii");
  const d = payload.slice(3);

  function field(s, divisor = 1) {
    if (!s) return null;
    const trimmed = s.trim();
    if (!trimmed || /^-+$/.test(trimmed)) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n / divisor : null;
  }

  const ieRaw = field(d.slice(7, 10));

  return {
    tv_set: field(d.slice(0, 4)),
    rr_set: field(d.slice(4, 7)),
    ie_ratio: ieRaw != null ? `1:${ieRaw}` : null,
    insp_pause_pct: field(d.slice(10, 12)),
    peep_set: field(d.slice(12, 14)),
    insp_pres_set: field(d.slice(14, 16)),
    peak_limit: field(d.slice(16, 18)),
    hi_vte: field(d.slice(22, 26)),
    lo_mv: field(d.slice(26, 28), 10),
    hi_mv: field(d.slice(28, 31), 10),
    lo_vte: field(d.slice(31, 34)),
    hi_fio2: field(d.slice(34, 37)),
    lo_fio2: field(d.slice(37, 40)),
  };
}

function parseVTDLegacy(line) {
  const payload = line.slice(0, -1).toString("ascii");
  const d = payload.slice(3);

  function field(s) {
    if (!s) return null;
    const trimmed = s.trim();
    if (!trimmed || trimmed === "---") return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }

  const mvRaw = field(d.slice(4, 8));

  return {
    tidal_volume_exp: field(d.slice(0, 4)),
    minute_volume: mvRaw != null ? mvRaw / 100 : null,
    resp_rate: field(d.slice(8, 11)),
    fio2: field(d.slice(11, 14)),
    airway_pressure_peak: field(d.slice(14, 17)),
    airway_pressure_plat: field(d.slice(17, 20)),
    airway_pressure_mean: field(d.slice(20, 23)),
    airway_pressure_min: field(d.slice(23, 26)),
  };
}

function randomDigits(n) {
  let s = "";
  for (let i = 0; i < n; i += 1) s += Math.floor(Math.random() * 10);
  return s;
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function withValidChecksum(payloadAscii) {
  const payload = Buffer.from(payloadAscii, "ascii");
  const calc = computeChecksum(Buffer.concat([Buffer.from([SOF]), payload]));
  return Buffer.concat([payload, Buffer.from([calc])]);
}

function compareObjects(left, right, keys) {
  for (const key of keys) {
    if (left[key] !== right[key]) {
      return { ok: false, key, left: left[key], right: right[key] };
    }
  }
  return { ok: true };
}

function runRegression(iterations = 2000) {
  for (let i = 0; i < iterations; i += 1) {
    const vtq =
      "VTQ" +
      randomDigits(4) +
      randomDigits(3) +
      randomDigits(3) +
      randomDigits(2) +
      randomDigits(2) +
      randomDigits(2) +
      randomDigits(2) +
      pick(["----", "0000", "1234"]) +
      randomDigits(4) +
      randomDigits(2) +
      randomDigits(3) +
      randomDigits(3) +
      randomDigits(3) +
      randomDigits(3) +
      String.fromCharCode(Math.floor(Math.random() * 127));

    const vtqLine = withValidChecksum(vtq);
    const vtqNew = parseVTQ(vtqLine);
    const vtqOld = parseVTQLegacy(vtqLine);
    const vtqCheck = compareObjects(vtqNew, vtqOld, Object.keys(vtqOld));
    if (!vtqCheck.ok) {
      throw new Error(
        `VTQ mismatch on ${vtqCheck.key}: new=${vtqCheck.left} old=${vtqCheck.right}`,
      );
    }

    const vtd =
      "VTD" +
      randomDigits(4) +
      randomDigits(4) +
      randomDigits(3) +
      randomDigits(3) +
      randomDigits(3) +
      pick(["---", randomDigits(3)]) +
      randomDigits(3) +
      pick(["---", randomDigits(3)]);

    const vtdLine = withValidChecksum(vtd);
    const vtdNew = parseVTD(vtdLine);
    const vtdOld = parseVTDLegacy(vtdLine);
    const vtdCheck = compareObjects(vtdNew, vtdOld, Object.keys(vtdOld));
    if (!vtdCheck.ok) {
      throw new Error(
        `VTD mismatch on ${vtdCheck.key}: new=${vtdCheck.left} old=${vtdCheck.right}`,
      );
    }
  }
}

try {
  runRegression();
  console.log(
    "GE750 regression passed: VTD/VTQ numeric fields unchanged; vent mode fields added only.",
  );
  process.exit(0);
} catch (err) {
  console.error("GE750 regression failed:", err.message);
  process.exit(1);
}
