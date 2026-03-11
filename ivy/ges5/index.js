const GES5Serial = require("./serial");
const CFG = require("./config");
const { buildAllLevelRequests } = require("./protocol");

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
// Each group starts with group_hdr_type (6 bytes):
//   [0-3] status_bits (UInt32)  [4-5] label_info (UInt16)
// then fields at offset +6 within the group.
//
// Group start offsets within basic_phdb_type (270 bytes, Pack=1):
//   ecg=0(16B), p1=16(14B), p2=30(14B), p3=44(14B), p4=58(14B),
//   nibp=72(14B), t1=86(8B), t2=94(8B), t3=102(8B), t4=110(8B),
//   spo2=118(14B), co2=132(14B), o2=146(10B), n2o=156(10B),
//   aa=166(12B), flow_vol=178(22B), co_wedge=200(14B), ...
//
// Scaling (from VSCaptureWave Class1.cs ShowBasicSubRecord ValidateAddData calls):
//   HR             → ×1  direct bpm
//   NIBP / P1 / P2 → ×0.01 → mmHg   (raw 12100 = 121 mmHg)
//   SpO2 %         → ×0.01 → %       (raw 9900  = 99 %)
//   SpO2_PR        → ×1  direct bpm
//   Temperature    → ×0.01 → °C      (raw 3700  = 37.00 °C)
//   EtCO2/FiCO2   → (raw_et × amb_press) × 0.00001 → kPa
//   CO2 RR         → ×1  direct
//   O2 / N2O / AA  → ×0.01 → %      (raw 5000  = 50.0 %)
//   AA MAC sum     → ×0.01
//   flow_vol: RR→×1, PPeak/PPlat/PEEP→×0.01 cmH2O, TV→×0.1 L, MV→×0.01 L/min
//             Compliance → ×0.01 mL/cmH2O
const AA_AGENT = ["Unknown","None","HAL","ENF","ISO","DES","SEV"];

function parseBasicPhdb(sub) {
  const v = {};

  // ── ECG group (offset 0, 16B) ──────────────────────────────────────────────
  const hr = readVal(sub, 6);   if (hr  !== null) v.HR     = hr;          // bpm
  const rr = readVal(sub, 14);  if (rr  !== null) v.RR_IMP = rr;          // br/min

  // ── Invasive pressures P1/P2 (offsets 16, 30 — 14B each) — ×0.01 = mmHg ──
  // p_group: hdr(6B) sys(2B) dia(2B) mean(2B) hr(2B)
  const p1s = readVal(sub, 22); if (p1s !== null) v.P1_SYS  = +(p1s * 0.01).toFixed(1);
  const p1d = readVal(sub, 24); if (p1d !== null) v.P1_DIA  = +(p1d * 0.01).toFixed(1);
  const p1m = readVal(sub, 26); if (p1m !== null) v.P1_MEAN = +(p1m * 0.01).toFixed(1);
  const p1h = readVal(sub, 28); if (p1h !== null) v.P1_HR   = p1h;        // bpm
  const p2s = readVal(sub, 36); if (p2s !== null) v.P2_SYS  = +(p2s * 0.01).toFixed(1);
  const p2d = readVal(sub, 38); if (p2d !== null) v.P2_DIA  = +(p2d * 0.01).toFixed(1);
  const p2m = readVal(sub, 40); if (p2m !== null) v.P2_MEAN = +(p2m * 0.01).toFixed(1);
  const p2h = readVal(sub, 42); if (p2h !== null) v.P2_HR   = p2h;        // bpm

  // ── NIBP (offset 72, 14B) — ×0.01 = mmHg ────────────────────────────────
  const ns = readVal(sub, 78);  if (ns  !== null) v.NIBP_SYS  = Math.round(ns  * 0.01);
  const nd = readVal(sub, 80);  if (nd  !== null) v.NIBP_DIA  = Math.round(nd  * 0.01);
  const nm = readVal(sub, 82);  if (nm  !== null) v.NIBP_MEAN = Math.round(nm  * 0.01);

  // ── Temperatures T1–T4 (offsets 86/94/102/110, 8B each) — ×0.01 = °C ───
  const t1 = readVal(sub, 92);  if (t1  !== null) v.T1 = (t1  * 0.01).toFixed(2);
  const t2 = readVal(sub, 100); if (t2  !== null) v.T2 = (t2  * 0.01).toFixed(2);
  const t3 = readVal(sub, 108); if (t3  !== null) v.T3 = (t3  * 0.01).toFixed(2);
  const t4 = readVal(sub, 116); if (t4  !== null) v.T4 = (t4  * 0.01).toFixed(2);

  // ── SpO2 (offset 118, 14B) — ×0.01 = %; PR direct ───────────────────────
  // SpO2_group: hdr(6B) SpO2(2B) pr(2B) ir_amp(2B) svo2(2B)
  const sp  = readVal(sub, 124); if (sp  !== null) v.SpO2    = Math.round(sp  * 0.01);
  const spr = readVal(sub, 126); if (spr !== null) v.SpO2_PR = spr;

  // ── CO2 (offset 132, 14B) — EtCO2 = (et × amb_press) × 0.00001 kPa ─────
  // co2_group: hdr(6B) et(2B) fi(2B) rr(2B) amb_press(2B)
  const amb = sub.length >= 146 ? sub.readInt16LE(144) : 0;
  const ce  = readVal(sub, 138);
  const cf  = readVal(sub, 140);
  const cr  = readVal(sub, 142);
  if (ce  !== null && amb > 0) v.CO2_ET = +((ce * amb) * 0.00001).toFixed(2); // kPa
  if (cf  !== null && amb > 0) v.CO2_FI = +((cf * amb) * 0.00001).toFixed(2); // kPa
  if (cr  !== null)            v.CO2_RR = cr;                                  // br/min

  // ── O2 (offset 146, 10B) — ×0.01 = % ────────────────────────────────────
  // o2_group: hdr(6B) et(2B) fi(2B)
  const oe  = readVal(sub, 152); if (oe  !== null) v.O2_ET = +(oe  * 0.01).toFixed(1);
  const of_ = readVal(sub, 154); if (of_ !== null) v.O2_FI = +(of_ * 0.01).toFixed(1);

  // ── N2O (offset 156, 10B) — ×0.01 = % ───────────────────────────────────
  const ne = readVal(sub, 162); if (ne  !== null) v.N2O_ET = +(ne  * 0.01).toFixed(1);
  const nf = readVal(sub, 164); if (nf  !== null) v.N2O_FI = +(nf  * 0.01).toFixed(1);

  // ── AA volatile agent (offset 166, 12B) — ×0.01 = %, MAC ×0.01 ──────────
  // aa_group: hdr(6B) et(2B) fi(2B) mac_sum(2B); label_info(at +4) = agent type
  const ae  = readVal(sub, 172); if (ae  !== null) v.AA_ET  = +(ae  * 0.01).toFixed(2);
  const af  = readVal(sub, 174); if (af  !== null) v.AA_FI  = +(af  * 0.01).toFixed(2);
  const am  = readVal(sub, 176); if (am  !== null) v.AA_MAC = +(am  * 0.01).toFixed(2);
  if (sub.length >= 172) {
    const agentCode = sub.readUInt16LE(170);                // label_info (at hdr+4 = 166+4)
    if (agentCode >= 0 && agentCode < AA_AGENT.length) v.AA_AGENT = AA_AGENT[agentCode];
  }

  // ── flow_vol (offset 178, 22B) — Aisys CS2 ventilator data ───────────────
  // flow_vol_group: hdr(6B) rr(2B) ppeak(2B) peep(2B) pplat(2B)
  //                 tv_insp(2B) tv_exp(2B) compliance(2B) mv_exp(2B)
  const fv_rr   = readVal(sub, 184); if (fv_rr   !== null) v.FV_RR         = fv_rr;                         // br/min ×1
  const fv_pp   = readVal(sub, 186); if (fv_pp   !== null) v.FV_PPEAK      = +(fv_pp   * 0.01).toFixed(1);  // cmH2O
  const fv_peep = readVal(sub, 188); if (fv_peep !== null) v.FV_PEEP       = +(fv_peep * 0.01).toFixed(1);  // cmH2O
  const fv_pl   = readVal(sub, 190); if (fv_pl   !== null) v.FV_PPLAT      = +(fv_pl   * 0.01).toFixed(1);  // cmH2O
  const fv_ti   = readVal(sub, 192); if (fv_ti   !== null) v.FV_TV_INSP    = +(fv_ti   * 0.1).toFixed(2);   // L
  const fv_te   = readVal(sub, 194); if (fv_te   !== null) v.FV_TV_EXP     = +(fv_te   * 0.1).toFixed(2);   // L
  const fv_comp = readVal(sub, 196); if (fv_comp !== null) v.FV_COMPLIANCE  = +(fv_comp * 0.01).toFixed(1);  // mL/cmH2O
  const fv_mv   = readVal(sub, 198); if (fv_mv   !== null) v.FV_MV_EXP     = +(fv_mv   * 0.01).toFixed(2);  // L/min

  return v;
}

// ─── Top-level PHDB packet parser ────────────────────────────────────────────
let _hexDumpCount = 0; // dump first 3 packets for offset verification

function parsePhdbPacket(payload) {
  const rLen      = payload.readUInt16LE(0);
  const rNbr      = payload[2];                 // sequence counter
  const rTime     = payload.readUInt32LE(6);    // Unix timestamp (seconds) from device
  const rMaintype = payload.readInt16LE(14);    // 0=DRI_MT_PHDB, 1=DRI_MT_WAVE

  if (rMaintype !== 0) {
    return { rNbr, rLen, rTime, rMaintype, skipped: true };
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

  return { rNbr, rLen, rTime, rMaintype, results };
}

// ─── Service ─────────────────────────────────────────────────────────────────
function startGES5Service(options = {}) {
  const port     = options.port     || CFG.PORT;
  const onPacket = typeof options.onPacket === "function" ? options.onPacket : null;
  const onOpen   = typeof options.onOpen   === "function" ? options.onOpen   : null;
  const onError  = typeof options.onError  === "function" ? options.onError  : null;
  const onClose  = typeof options.onClose  === "function" ? options.onClose  : null;

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
    const req  = buildAllLevelRequests(ival);

    // Send requests for all DRI firmware levels (2005/2003/2001 = levels 9/8/7).
    // The B650 ignores requests whose r_dri_level doesn't match its firmware.
    // VSCaptureWave Main.cs sends all three — we do the same.
    console.log(
      `[GES5] Sending DRI_PH_DISPL × 3 levels (tx_ival=${ival}s)` +
      `  hex=${req.toString("hex").slice(0, 80)}...`
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
    if (onClose) onClose();
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
