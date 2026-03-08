const GES5Serial = require("./serial");
const CFG = require("./config");
const { buildDisplayRequest } = require("./protocol");

// ─── Datex S/5 constants ────────────────────────────────────────────────────
const DATA_INVALID     = -32767; // value not available
const DATA_NOT_UPDATED = -32766; // value not refreshed yet
const PHDB_HDR_BYTES   = 40;    // datex_hdr_type is exactly 40 bytes

// Each PHDB subrecord in the response contains a small per-subrecord header
// before the actual basic/ext_phdb_type data.  dri_phdb.cs shows:
//   uint time (4 bytes) — per-subrecord Unix timestamp
//   ...then the 270-byte phdb data
// Giving 278 bytes per subrecord (4 + 270 + 4 tail = 278).
const PHDB_SUBR_HDR = 4; // bytes to skip before basic/ext_phdb_type within each subrecord

// ─── sr_desc parsing ────────────────────────────────────────────────────────
// Per VSCaptureWave sr_desc_type.cs (StructLayout Sequential Pack=1):
//   short  sr_offset  (2 bytes LE) — byte offset from data-area start (byte 40) to subrecord
//   byte   sr_type    (1 byte)     — 0x01=DRI_PH_DISPL, 0x02=10S, 0x03=60S
// EOL: sr_offset low byte = 0xFF (DRI_EOL_SUBR_LIST = 255)
function parseSrDesc(payload) {
  const entries = [];
  for (let i = 0; i < 8; i++) {
    const base      = 16 + i * 3;
    const sr_offset = payload.readInt16LE(base);   // FIRST: signed Int16 LE
    const sr_type   = payload[base + 2];           // THEN: type byte
    if ((sr_offset & 0xFF) === 0xFF) break;        // DRI_EOL_SUBR_LIST
    if (sr_type   === 0xFF) break;
    entries.push({ sr_type, sr_offset });
  }
  return entries;
}

// ─── basic_phdb_type field reader ────────────────────────────────────────────
// Returns null for DATA_INVALID / DATA_NOT_UPDATED; raw Int16 otherwise.
function readVal(buf, offset) {
  if (offset + 2 > buf.length) return null;
  const v = buf.readInt16LE(offset);
  if (v === DATA_INVALID || v === DATA_NOT_UPDATED) return null;
  return v;
}

// Parse vital signs from one basic_phdb_type subrecord (VSCaptureWave offsets, Pack=1).
//
// sub: Buffer slice starting at the first byte of basic_phdb_type
//      (caller already skips the PHDB_SUBR_HDR bytes)
//
// Each parameter group starts with group_hdr_type (6 bytes):
//   [0-3] status_bits (UInt32)  [4-5] label_info (UInt16)
// then the actual measurement value(s) at offset +6 within the group.
//
// Group start offsets within basic_phdb_type:
//   ecg=0(16B), p1=16(14B), p2=30(14B), p3=44(14B), p4=58(14B),
//   nibp=72(14B), t1=86(8B), t2=94(8B), t3=102(8B), t4=110(8B),
//   spo2=118(14B), co2=132(14B), o2=146(10B), n2o=156(10B), aa=166(12B), ...
//
// Scaling (Datex-Ohmeda S/5 convention, verified against AS3 capture):
//   HR             → direct (bpm)
//   NIBP           → raw ÷ 100 (mmHg)   ← raw stores e.g. 12100 for 121 mmHg
//   SpO2 %         → raw ÷ 100 (%)      ← raw stores e.g. 9900 for 99 %
//   SpO2_PR        → direct (bpm pulse rate)
//   Temperature    → raw ÷ 10  (°C)
//   EtCO2 / FiCO2 → raw ÷ 100 (kPa)
//   CO2 RR         → direct (breaths/min)
//   O2 / N2O / AA  → raw ÷ 10  (%)
//   AA MAC sum     → raw ÷ 100
function parseBasicPhdb(sub) {
  const v = {};

  // ECG group (offset 0)
  const hr = readVal(sub, 6);   if (hr  !== null) v.HR     = hr;   // bpm
  const rr = readVal(sub, 14);  if (rr  !== null) v.RR_IMP = rr;   // breaths/min (impedance)

  // P1–P4 invasive pressures (offsets 16, 30, 44, 58) — mmHg
  const p1s = readVal(sub, 22); if (p1s !== null) v.P1_SYS  = p1s;
  const p1d = readVal(sub, 24); if (p1d !== null) v.P1_DIA  = p1d;
  const p1m = readVal(sub, 26); if (p1m !== null) v.P1_MEAN = p1m;
  const p2s = readVal(sub, 36); if (p2s !== null) v.P2_SYS  = p2s;
  const p2d = readVal(sub, 38); if (p2d !== null) v.P2_DIA  = p2d;
  const p2m = readVal(sub, 40); if (p2m !== null) v.P2_MEAN = p2m;

  // NIBP (offset 72) — raw ÷ 100 = mmHg
  const ns = readVal(sub, 78);  if (ns  !== null) v.NIBP_SYS  = Math.round(ns / 100);
  const nd = readVal(sub, 80);  if (nd  !== null) v.NIBP_DIA  = Math.round(nd / 100);
  const nm = readVal(sub, 82);  if (nm  !== null) v.NIBP_MEAN = Math.round(nm / 100);

  // Temperatures (offsets 86, 94, 102, 110) — raw ÷ 10 = °C
  const t1 = readVal(sub, 92);  if (t1  !== null) v.T1 = (t1 / 10).toFixed(1);
  const t2 = readVal(sub, 100); if (t2  !== null) v.T2 = (t2 / 10).toFixed(1);
  const t3 = readVal(sub, 108); if (t3  !== null) v.T3 = (t3 / 10).toFixed(1);
  const t4 = readVal(sub, 116); if (t4  !== null) v.T4 = (t4 / 10).toFixed(1);

  // SpO2 (offset 118) — raw ÷ 100 = %; SpO2_PR is pulse rate, direct bpm
  const sp  = readVal(sub, 124); if (sp  !== null) v.SpO2    = Math.round(sp  / 100);
  const spr = readVal(sub, 126); if (spr !== null) v.SpO2_PR = spr;

  // CO2 (offset 132) — EtCO2/FiCO2 in kPa×100, RR direct
  const ce = readVal(sub, 138); if (ce  !== null) v.CO2_ET = (ce  / 100).toFixed(2); // kPa
  const cf = readVal(sub, 140); if (cf  !== null) v.CO2_FI = (cf  / 100).toFixed(2); // kPa
  const cr = readVal(sub, 142); if (cr  !== null) v.CO2_RR = cr;                     // br/min

  // O2 (offset 146) — raw ÷ 10 = %
  const oe = readVal(sub, 152); if (oe  !== null) v.O2_ET = (oe / 10).toFixed(1);
  const of_ = readVal(sub, 154); if (of_ !== null) v.O2_FI = (of_ / 10).toFixed(1);

  // N2O (offset 156) — raw ÷ 10 = %
  const ne = readVal(sub, 162); if (ne  !== null) v.N2O_ET = (ne / 10).toFixed(1);
  const nf = readVal(sub, 164); if (nf  !== null) v.N2O_FI = (nf / 10).toFixed(1);

  // AA volatile agent (offset 166) — raw ÷ 10 = %, MAC ÷ 100
  const ae  = readVal(sub, 172); if (ae  !== null) v.AA_ET  = (ae  / 10).toFixed(1);
  const af  = readVal(sub, 174); if (af  !== null) v.AA_FI  = (af  / 10).toFixed(1);
  const am  = readVal(sub, 176); if (am  !== null) v.AA_MAC = (am  / 100).toFixed(2);

  return v;
}

// ─── Top-level PHDB packet parser ────────────────────────────────────────────
let _hexDumpCount = 0; // dump first 3 packets for offset verification

function parsePhdbPacket(payload) {
  const rLen      = payload.readUInt16LE(0);
  const rNbr      = payload[2];                 // sequence counter
  const rMaintype = payload.readInt16LE(14);    // 0=DRI_MT_PHDB, 1=DRI_MT_WAVE

  if (rMaintype !== 0) {
    return { rNbr, rLen, rMaintype, skipped: true };
  }

  // ── Debug: dump first 2 packets + vital-sign scanner ────────────────────
  if (_hexDumpCount < 2) {
    _hexDumpCount++;
    // Full hex dump (first 320 bytes — covers header + first two subrecords)
    const dumpLen = Math.min(payload.length, 320);
    console.log(`\n[GES5] ══ DUMP #${_hexDumpCount} (${payload.length}B total, showing ${dumpLen}B) ══`);
    for (let i = 0; i < dumpLen; i += 16) {
      const chunk = payload.slice(i, Math.min(i + 16, dumpLen));
      const hex   = chunk.toString("hex").match(/.{1,2}/g).join(" ");
      const ascii = chunk.toString("ascii").replace(/[^\x20-\x7e]/g, ".");
      console.log(`  ${String(i).padStart(3, " ")}: ${hex.padEnd(47)} |${ascii}|`);
    }

    // ── Vital-sign scanner: search entire packet for known values ──────────
    // User has HR≈74-75, SpO2≈99-100; find every Int16LE in those ranges.
    console.log("\n[GES5] ── Vital-sign scanner (Int16LE values in packet) ──");
    const HR_LO = 65, HR_HI = 85, SPO2_LO = 95, SPO2_HI = 100;
    const hrHits = [], spo2Hits = [];
    for (let i = 0; i + 1 < payload.length; i++) {
      const v = payload.readInt16LE(i);
      if (v >= HR_LO   && v <= HR_HI)   hrHits.push(`off=${i}(0x${i.toString(16)}) val=${v}`);
      if (v >= SPO2_LO && v <= SPO2_HI) spo2Hits.push(`off=${i}(0x${i.toString(16)}) val=${v}`);
    }
    console.log(`  HR  candidates (${HR_LO}-${HR_HI}): ${hrHits.length ? hrHits.join("  ") : "none"}`);
    console.log(`  SpO2 candidates (${SPO2_LO}-${SPO2_HI}): ${spo2Hits.length ? spo2Hits.join("  ") : "none"}`);

    // ── Probe sr_desc subrecords with header sizes 0, 4, 8 ────────────────
    console.log("\n[GES5] ── Subrecord probe (PHDB_SUBR_HDR = 0 / 4 / 8) ──");
    const srList2 = parseSrDesc(payload);
    console.log(`  sr_desc entries: ${JSON.stringify(srList2)}`);
    for (const hdr of [0, 4, 8]) {
      for (const { sr_type, sr_offset } of srList2) {
        const dataStart2 = PHDB_HDR_BYTES + sr_offset + hdr;
        if (dataStart2 + 130 > payload.length) continue;
        const sub2 = payload.slice(dataStart2);
        const hrV   = sub2.length >= 8   ? sub2.readInt16LE(6)   : null;
        const spo2V = sub2.length >= 126  ? sub2.readInt16LE(124) : null;
        const t1V   = sub2.length >= 94   ? sub2.readInt16LE(92)  : null;
        const nibpS = sub2.length >= 80   ? sub2.readInt16LE(78)  : null;
        const kind2 = sr_type === 1 ? "DISPL" : sr_type === 2 ? "10S" : sr_type === 3 ? "60S" : `t${sr_type}`;
        console.log(
          `  hdr=${hdr} [${kind2}@sr_off=${sr_offset}] dataStart=${dataStart2}` +
          `  HR=${hrV} SpO2=${spo2V} T1=${t1V !== null ? (t1V/10).toFixed(1) : null} NIBP_SYS=${nibpS}`
        );
      }
    }
    console.log("");
  }

  const srList  = parseSrDesc(payload);
  const results = [];

  for (const { sr_type, sr_offset } of srList) {
    // Subrecord starts at byte [PHDB_HDR_BYTES + sr_offset].
    // Skip PHDB_SUBR_HDR bytes (per-subrecord timestamp) to reach basic/ext_phdb_type.
    const subStart  = PHDB_HDR_BYTES + sr_offset;
    const dataStart = subStart + PHDB_SUBR_HDR;
    if (dataStart >= payload.length) continue;
    const sub  = payload.slice(dataStart);
    const vals = parseBasicPhdb(sub);
    const kind = sr_type === 1 ? "DISPL" : sr_type === 2 ? "10S" : sr_type === 3 ? "60S" : `t${sr_type}`;
    results.push({ kind, sr_offset, vals });
  }

  return { rNbr, rLen, rMaintype, results };
}

// ─── Service ─────────────────────────────────────────────────────────────────
function startGES5Service(options = {}) {
  const port     = options.port     || CFG.PORT;
  const onPacket = typeof options.onPacket === "function" ? options.onPacket : null;
  const onOpen   = typeof options.onOpen   === "function" ? options.onOpen   : null;
  const onError  = typeof options.onError  === "function" ? options.onError  : null;

  if (!port) {
    console.error("[GES5] No port configured. Set GES5_PORT env var.");
    return;
  }

  const s5 = new GES5Serial({
    path:     port,
    baudRate: CFG.BAUD_RATE,
    parity:   CFG.PARITY,
  });

  let requestTimer = null;

  console.log(`[GES5] starting service on ${port} (19200 8E1)...`);

  s5.on("open", () => {
    console.log("[GES5] serial open");
    if (onOpen) onOpen({ port });

    const ival = CFG.TRANSMISSION_INTERVAL;
    const req  = buildDisplayRequest(ival);

    console.log(
      `[GES5] Sending DRI_PH_DISPL request (tx_ival=${ival}s)` +
      `  hex=${req.toString("hex")}`
    );
    s5.write(req);

    // Re-send if we hear nothing:
    //   20 s while waiting for first packet (device needs a few nudges to start)
    //   60 s once streaming (recovery only)
    let streaming = false;
    s5.once("packet", () => { streaming = true; });

    function armSilenceTimer() {
      if (requestTimer) clearTimeout(requestTimer);
      const ms = streaming ? 60000 : 20000;
      requestTimer = setTimeout(() => {
        console.log(
          streaming
            ? "[GES5] 60 s silence — re-sending DRI_PH_DISPL (stream recovery)"
            : "[GES5] 20 s silence — re-sending DRI_PH_DISPL (waking device)"
        );
        s5.write(req);
        armSilenceTimer();
      }, ms);
    }

    s5.on("_raw_activity", armSilenceTimer);
    armSilenceTimer();
  });

  s5.on("packet", (payload) => {
    if (payload.length < PHDB_HDR_BYTES) {
      console.warn("[GES5] Packet too short:", payload.toString("hex"));
      return;
    }

    const parsed = parsePhdbPacket(payload);

    if (parsed.skipped) {
      // Wave packet or unknown — log briefly and skip
      console.log(`[GES5] Packet < r_maintype=${parsed.rMaintype} r_nbr=${parsed.rNbr} r_len=${parsed.rLen} (not PHDB, skipped)`);
      return;
    }

    console.log(`[GES5] PHDB r_nbr=${parsed.rNbr} r_len=${parsed.rLen} subrecords=${parsed.results.length}`);

    for (const { kind, sr_offset, vals } of parsed.results) {
      const keys = Object.keys(vals);
      if (keys.length === 0) {
        console.log(`  [${kind}@${sr_offset}] — all values invalid/not-updated`);
      } else {
        const line = keys.map(k => `${k}=${vals[k]}`).join("  ");
        console.log(`  [${kind}@${sr_offset}] ${line}`);
      }
    }

    if (onPacket) onPacket(payload, parsed);
  });

  s5.on("error", (err) => {
    console.error("[GES5] serial error:", err.message);
    if (onError) onError(err);
  });

  s5.on("close", () => {
    console.log("[GES5] serial closed");
    if (requestTimer) clearTimeout(requestTimer);
  });

  s5.open();

  return {
    serial: s5,
    stop() {
      if (requestTimer) clearTimeout(requestTimer);
      s5.close();
    }
  };
}

if (require.main === module) {
  startGES5Service();
}

module.exports = { startGES5Service, parsePhdbPacket };
