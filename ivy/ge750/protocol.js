const { computeChecksum } = require("./checksum");

const SOF = 0x3a; // ':' — device includes SOF byte in checksum calculation

// ─────────────────────────────────────────────────────────────────────────────
// COM 1.2 vent mode chars — VTq byte 46 → d[42]
// IMPORTANT: COM 1.2 redefined 'i' as SIMV-PC (COM 1.0 used 'i' for VCV/IPPV)
// ─────────────────────────────────────────────────────────────────────────────
const VENT_MODE_CHAR = {
  v: "VCV",        // Volume Control Ventilation (CMV)
  "@": "VCV",      // Some GE firmware revisions emit '@' for VCV
  p: "PCV",        // Pressure Control Ventilation
  b: "VCV-BU",     // Backup Volume Control
  g: "PCV-VG",     // PCV with Volume Guarantee
  G: "BiLevel-VG",
  s: "SIMV-VC",    // SIMV Volume Control
  i: "SIMV-PC",    // SIMV-PC  (NOTE: in COM 1.2 'i' ≠ VCV)
  S: "SIMV-PCVG",
  B: "BiLevel",
  c: "CPAP/PSV",   // CPAP with optional Pressure Support
  a: "CPAP-Apnea",
  n: "NIV",
  o: "PSV-Pro",
  m: "MAN",
  M: "MAN",
  "-": "BAG",      // Bag / manual ventilation mode (device not mechanically ventilating)
};

// Anesthetic agent identification — VTd byte 108 → d[104] (1-byte field)
const AGENT_ID_CHAR = {
  "0": null,    // Not Used
  "1": "ISO",   // Isoflurane
  "2": null,
  "3": null,    // No agent
  "5": "DES",   // Desflurane
  "6": "SEVO",  // Sevoflurane
};

function ventModeFromChar(ch) {
  if (!ch) return null;
  return VENT_MODE_CHAR[ch] || `mode_${ch.charCodeAt(0)}`;
}

function pickVentModeChar(d) {
  // Primary COM 1.2 position (byte 46 -> d[42]).
  if (d.length <= 42) return null;
  const primary = String.fromCharCode(d[42]);
  if (VENT_MODE_CHAR[primary]) return primary;

  // Fallback for firmware/offset variants that shift one byte left/right.
  const fallbackIndexes = [41, 43, 40, 44];
  for (const idx of fallbackIndexes) {
    if (idx < 0 || idx >= d.length) continue;
    const ch = String.fromCharCode(d[idx]);
    if (VENT_MODE_CHAR[ch]) return ch;
  }
  return primary;
}

function agentFromChar(ch) {
  if (!ch) return null;
  return (ch in AGENT_ID_CHAR) ? AGENT_ID_CHAR[ch] : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// parseVTLine — strip and verify checksum
// line = payload WITHOUT leading ':' and WITHOUT trailing CR
// ─────────────────────────────────────────────────────────────────────────────
function parseVTLine(line) {
  if (line.length > 2) {
    const data  = line.slice(0, -1);
    const rxChk = line[line.length - 1];
    const withSof = Buffer.concat([Buffer.from([SOF]), data]);
    const calc = computeChecksum(withSof);
    if (rxChk === calc) return data;
  }
  return line; // fallback: no checksum byte present
}

// ═════════════════════════════════════════════════════════════════════════════
// parseVTD — COM 1.2  :VTd  Measured Data Response
//
// Notation:  d[n] = protocol byte (n + 4)   because header ":VTd" = bytes 0-3
//            d = payload.slice(3)  after stripping the "VTd" prefix
//
// ┌─────────────────────── STANDARD fields (every frame) ────────────────────┐
// │ d[0:4]    TVexp      Expired tidal volume             mL                 │
// │ d[4:8]    MVexp×100  Minute volume                    L  (÷100)          │
// │ d[8:11]   RRtotal    Total respiratory rate           /min               │
// │ d[11:14]  FiO2circ   Circuit O2 (internal sensor)    %                  │
// │ d[14:17]  Ppeak      Max airway pressure              cmH2O              │
// │ d[17:20]  Pplat      Plateau pressure                 cmH2O              │
// │ d[20:23]  Pmean      Mean airway pressure             cmH2O              │
// │ d[23:26]  —          NOT USED  (spec bytes 27-29)                        │
// └───────────────────────────────────────────────────────────────────────────┘
//
// ┌─────────────────── EXTENDED fields (long frame, d.length > 70) ──────────┐
// │ d[26:30]  MVspont×100 Spont. exp. minute volume       L  (÷100)          │
// │ d[30:33]  RRspont     Spont. respiratory rate         /min               │
// │ d[33:36]  PEEPi       Intrinsic PEEP                  cmH2O  (÷10)       │
// │ d[36:38]  Compliance  Dynamic compliance              mL/cmH2O           │
// │ d[64:67]  PEEPe       Extrinsic PEEP (set value)      cmH2O  (÷10)       │
// │ d[67:70]  PEEPe+i     Total PEEP  ← GE "PEEPei"       cmH2O  (÷10)      │
// └───────────────────────────────────────────────────────────────────────────┘
//
// ┌──────────────── MGAS module fields (d.length > 120) ─────────────────────┐
// │ d[79:82]  FiO2mgas    MGAS inspired O2                %                  │
// │ d[82:85]  EtO2        End-tidal O2                    %                  │
// │ d[89:92]  FiCO2       Inspired CO2                    %  (÷10)           │
// │ d[92:95]  EtCO2       End-tidal CO2                   %  (÷10)           │
// │ d[98:101] FiAA        Inspired anesthetic agent       %  (÷10)           │
// │ d[101:104] EtAA       End-tidal anesthetic agent      %  (÷10)           │
// │ d[104]    AA_id       Primary agent char              '5'=DES '6'=SEVO   │
// │ d[105:108] FiAA_2nd   Inspired secondary agent        %  (÷10)           │
// │ d[108:111] EtAA_2nd   End-tidal secondary agent       %  (÷10)           │
// │ d[111]    AA_id_2nd   Secondary agent char                               │
// │ d[112:115] FiN2O      Inspired N2O                    %  (÷10)           │
// │ d[115:118] EtN2O      End-tidal N2O                   %  (÷10)           │
// │ d[118:120] MAC        MAC value                       ×10  (÷10)         │
// └───────────────────────────────────────────────────────────────────────────┘
//
// ┌──────────────── Gas flow fields (d.length > 192) ────────────────────────┐
// │ d[180:184] O2 flow    Measured O2 fresh gas flow      L/min  (÷100)      │
// │ d[184:188] N2O flow   Measured N2O flow               L/min  (÷100)      │
// │ d[188:192] Air flow   Measured air flow               L/min  (÷100)      │
// └───────────────────────────────────────────────────────────────────────────┘
//
// NOTE: d[192] = airway pressure measurement source ('i'=internal 'm'=MGAS)
//       — this is NOT vent mode.
//       Sevo/Des ml/hr flow rates are NOT transmitted by this protocol.
// ═════════════════════════════════════════════════════════════════════════════
function parseVTD(line) {
  const payload = parseVTLine(line).toString("ascii");
  const d = payload.slice(3); // strip "VTd" prefix

  function field(s, divisor) {
    if (!s) return null;
    const t = s.trim();
    if (!t || /^-+$/.test(t) || /^\?+$/.test(t)) return null;
    const n = Number(t);
    if (!Number.isFinite(n)) return null;
    return divisor != null ? n / divisor : n;
  }

  const mvRaw = field(d.slice(4, 8));

  // ── Standard fields — confirmed positions, do not alter ─────────────────
  const result = {
    tidal_volume_exp:     field(d.slice(0, 4)),               // mL
    minute_volume:        mvRaw != null ? mvRaw / 100 : null, // L/min
    resp_rate:            field(d.slice(8, 11)),               // /min
    fio2:                 field(d.slice(11, 14)),              // % circuit O2 (internal)
    airway_pressure_peak: field(d.slice(14, 17)),              // cmH2O
    airway_pressure_plat: field(d.slice(17, 20)),              // cmH2O ("---" if no pause)
    airway_pressure_mean: field(d.slice(20, 23)),              // cmH2O
    airway_pressure_min:  field(d.slice(23, 26)),              // cmH2O
    // d[26:...] extended fields follow
  };

  // ── Extended ventilator fields (long VTd only) ───────────────────────────
  if (d.length > 70) {
    const mvSpontRaw = field(d.slice(26, 30));
    result.mv_spont           = mvSpontRaw != null ? mvSpontRaw / 100 : null; // L/min
    result.rr_spont           = field(d.slice(30, 33));          // /min
    result.peep_intrinsic     = field(d.slice(33, 36), 10);      // cmH2O  PEEPi
    result.compliance         = field(d.slice(36, 38));           // mL/cmH2O  (2 chars)
    result.airway_resistance  = field(d.slice(38, 41), 10);      // cm H2O/L/s  (spec bytes 42-44, ×10)
    // d[41] = Punits char, d[42] = Funits char — skipped (not numeric)
    result.tidal_volume_exp_spont = field(d.slice(43, 47));      // mL  TVexp spont (spec bytes 47-50)
    result.tidal_volume_insp      = field(d.slice(47, 51));      // mL  TVinsp (spec bytes 51-54)
    const mvInspRaw = field(d.slice(51, 55));
    result.minute_volume_insp = mvInspRaw != null ? mvInspRaw / 100 : null; // L/min (L×100, spec bytes 55-58)
    result.peep_extrinsic     = field(d.slice(64, 67), 10);      // cmH2O  PEEPe
    result.peep_total         = field(d.slice(67, 70), 10);      // cmH2O  PEEPe+i  ← GE "Total PEEP"
  }

  // ── MGAS gas analysis fields (requires MGAS module) ─────────────────────
  if (d.length > 120) {
    // O2 (bytes 83-88)
    result.fio2_meas  = field(d.slice(79, 82));              // % MGAS FiO2
    result.et_o2      = field(d.slice(82, 85));              // % EtO2
    // CO2 (bytes 93-98)
    result.fi_co2     = field(d.slice(89, 92), 10);          // % FiCO2  (spec bytes 93-95)
    result.et_co2     = field(d.slice(92, 95), 10);          // % EtCO2  (spec bytes 96-98)
    result.rr_co2     = field(d.slice(95, 98));              // /min  RRCO2 (spec bytes 99-101)
    // Primary anesthetic agent (bytes 102-108)
    result.fi_agent   = field(d.slice(98, 101), 10);         // % FiAA
    result.et_agent   = field(d.slice(101, 104), 10);        // % EtAA
    result.agent_id   = agentFromChar(d[104]);               // 'DES'|'SEVO'|'ISO'|null
    // Secondary anesthetic agent (bytes 109-115)
    result.fi_agent_2nd = field(d.slice(105, 108), 10);      // % FiAA 2nd
    result.et_agent_2nd = field(d.slice(108, 111), 10);      // % EtAA 2nd
    result.agent_id_2nd = agentFromChar(d[111]);             // secondary agent
    // N2O (bytes 116-121)
    result.fi_n2o     = field(d.slice(112, 115), 10);        // % FiN2O
    result.et_n2o     = field(d.slice(115, 118), 10);        // % EtN2O
    // MAC (bytes 122-123)
    result.mac        = field(d.slice(118, 120), 10);        // MAC
  }

  // ── Gas supply / pipeline pressures (spec bytes 148-156 = d[144:153]) ─────
  if (d.length > 153) {
    result.pressure_o2_supply  = field(d.slice(144, 147));   // kPa  O2 pipeline
    result.pressure_n2o_supply = field(d.slice(147, 150));   // kPa  N2O pipeline
    result.pressure_air_supply = field(d.slice(150, 153));   // kPa  Air pipeline
  }

  // ── Gas flow rates from flowmeters (spec bytes 184-195 = d[180:192]) ─────
  if (d.length > 192) {
    result.flow_o2  = field(d.slice(180, 184), 100);         // L/min
    result.flow_n2o = field(d.slice(184, 188), 100);         // L/min  (null = not installed)
    result.flow_air = field(d.slice(188, 192), 100);         // L/min
  }

  // ── Measured breath timing (spec bytes 199-204 = d[195:201]) ─────────────
  if (d.length > 201) {
    result.t_insp_meas = field(d.slice(195, 198), 10);       // s  measured inspiratory time
    result.t_exp_meas  = field(d.slice(198, 201), 10);       // s  measured expiratory time
  }

  return result;
}

// ═════════════════════════════════════════════════════════════════════════════
// parseVTQ — COM 1.2  :VTq  Status Data Response
//
// Notation:  d[n] = protocol byte (n + 4)
//            d = payloadBuf.slice(3)  after stripping the "VTq" prefix
//
// CRITICAL — COM 1.2 I:E field is 4 bytes (bytes 11-14), NOT 3 bytes as in
// COM 1.0. This shifts every field after I:E by 1 byte compared to COM 1.0.
//
// ┌─────────────────── Settings fields ──────────────────────────────────────┐
// │ d[0:4]    tv_set        Set tidal volume           mL        bytes 4-7   │
// │ d[4:7]    rr_set        Set respiratory rate       /min      bytes 8-10  │
// │ d[7:11]   I:E denom×10  e.g. "0020" → 2.0 → "1:2.0"        bytes 11-14 │
// │ d[13:15]  peep_set      Set PEEP                   cmH2O     bytes 17-18 │
// │ d[15:18]  peak_limit    Peak pressure limit        cmH2O     bytes 19-21 │
// │ d[18:20]  insp_pres_set Set inspired pressure      cmH2O     bytes 22-23 │
// │ d[42]     vent_mode     Vent mode char             1 char    byte 46     │
// │ d[46:49]  fio2_set      Set O2 in fresh gas        %         bytes 50-52 │
// │ d[51:53]  psupp         Pressure support           cmH2O     bytes 55-56 │
// │ d[119:121] flow_trigger Set flow trigger           L/min×10  bytes 123-124│
// │ d[125:127] end_flow     Set end-flow (ETS)         %         bytes 129-130│
// │ d[127:131] t_insp_set   Set inspiratory time       s×10      bytes 131-134│
// │ d[167:171] fgf_total    Set total fresh gas flow   L/min×100 bytes 171-174│
// └───────────────────────────────────────────────────────────────────────────┘
// ═════════════════════════════════════════════════════════════════════════════
function parseVTQ(line) {
  const payloadBuf = parseVTLine(line);
  const d = payloadBuf.slice(3); // Buffer after "VTq" prefix

  function field(rawSlice, divisor) {
    const s = Buffer.isBuffer(rawSlice)
      ? rawSlice.toString("ascii")
      : String(rawSlice ?? "");
    if (!s) return null;
    const t = s.trim();
    if (!t || /^-+$/.test(t)) return null;
    const n = Number(t);
    if (!Number.isFinite(n)) return null;
    return divisor != null ? n / divisor : n;
  }

  // I:E denominator: 4-byte field (COM 1.2), e.g. "0020" ÷10 → 2.0 → "1:2.0"
  const ieRaw = field(d.slice(7, 11));
  // Set Inspiratory Pause: 2-byte field at d[11:13] = spec bytes 15-16, % insp time
  const tpauseSet = field(d.slice(11, 13));

  let modeCh  = null;
  let fio2Set = null;

  modeCh = pickVentModeChar(d);
  if (d.length > 49) fio2Set = field(d.slice(46, 49));     // Set O2 in FGF (% O2)

  function formatIERatio(denomRaw) {
    if (denomRaw == null) return null;
    const val = denomRaw / 10;
    // If it's an integer (like 2.0), show 1:2. Otherwise 1:2.5
    const displayDenom = val % 1 === 0 ? String(val) : val.toFixed(1);
    return `1:${displayDenom}`;
  }

  return {
    // ── Mode & basic settings (all modes) ──────────────────────────────────
    vent_mode:      ventModeFromChar(modeCh),                         // e.g. "VCV"
    tv_set:         field(d.slice(0, 4)),                             // mL
    rr_set:         field(d.slice(4, 7)),                             // /min
    ie_ratio:       formatIERatio(ieRaw),                             // "1:2" or "1:2.5"
    tpause_set:     tpauseSet,                                        // % inspiratory pause (spec bytes 15-16)
    peep_set:       field(d.slice(13, 15)),                           // cmH2O
    peak_limit:     field(d.slice(15, 18)),                           // cmH2O
    // ── Pressure-mode settings ──────────────────────────────────────────────
    insp_pres_set:  field(d.slice(18, 20)),                           // cmH2O  (PCV/CPAP/PSV)
    // ── Gas settings ────────────────────────────────────────────────────────
    fio2_set:       fio2Set,                                          // % O2 in FGF
    fgf_total:      d.length > 171 ? field(d.slice(167, 171), 100) : null, // L/min
    // ── PSV / SIMV / trigger settings ───────────────────────────────────────
    psupp:          d.length > 53  ? field(d.slice(51, 53))           : null, // cmH2O
    flow_trigger:   d.length > 121 ? field(d.slice(119, 121), 10)    : null, // L/min
    end_flow:       d.length > 127 ? field(d.slice(125, 127))        : null, // % ETS
    t_insp_set:     d.length > 131 ? field(d.slice(127, 131), 10)   : null, // s
  };
}

module.exports = { parseVTLine, parseVTD, parseVTQ };

