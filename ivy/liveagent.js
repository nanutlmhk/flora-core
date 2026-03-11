/**
 * liveagent.js — synthetic data agent for local/dev testing
 *
 * Simulates two devices against the ivy /mock/device endpoint:
 *   MONITOR  → GE patient monitor (HL7 protocol)   — raw codes: MDC numeric (149514, 150456, …)
 *   MACHINE  → GE Carestation 750 (ge750_serial)   — raw codes: GE750_* constants
 *
 * By sending the real protocol + real raw_codes the mock data flows through the
 * same parameter_aliases lookup as live devices, so ivy_observations contains
 * meaningful ivy_param values and the minuteWriter produces real records.
 *
 * Usage:
 *   node liveagent.js
 *   IVY_MOCK_URL=http://host:3000/mock/device node liveagent.js
 */

const IVY_URL          = process.env.IVY_MOCK_URL           || "http://localhost:3000/mock/device";
const MONITOR_DEVICE_ID = process.env.LIVEAGENT_MONITOR_DEVICE_ID || "LIVEAGENT_HL7_01";
const MACHINE_DEVICE_ID = process.env.LIVEAGENT_MACHINE_DEVICE_ID || "LIVEAGENT_GE750_01";
const VERBOSE          = process.env.LIVEAGENT_VERBOSE !== "0";

// ── Protocols that mirror real device alias tables ─────────────────────────
const PROTO_HL7  = "hl7";
const PROTO_GE750 = "ge750_serial";

// ── Vent mode pool (matches GE750 VENT_MODE_CHAR mapping in protocol.js) ──
const VENT_MODES = ["VCV", "PCV", "SIMV-VC", "SIMV-PC", "CPAP/PSV", "PCV-VG"];

// ─────────────────────────────────────────────────────────────────────────────
// Drift utilities
// ─────────────────────────────────────────────────────────────────────────────
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randFloat(min, max) {
  return min + Math.random() * (max - min);
}
function driftInt(current, { min, max, maxStep }) {
  return clamp(Math.round(current + randInt(-maxStep, maxStep)), min, max);
}
function driftFloat(current, { min, max, maxStep, decimals = 1 }) {
  return Number(clamp(current + randFloat(-maxStep, maxStep), min, max).toFixed(decimals));
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP helpers
// ─────────────────────────────────────────────────────────────────────────────
async function send(deviceId, protocol, raw_code, value, unit) {
  const payload = { deviceId, protocol, raw_code, value, unit, device_ts: Date.now() };
  try {
    const res  = await fetch(IVY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    if (VERBOSE) {
      console.log("[LIVEAGENT] sent", JSON.stringify(payload), `status=${res.status}`, text);
    }
  } catch (e) {
    console.error("[LIVEAGENT] ERROR", e.message);
  }
}

function sendMany(deviceId, protocol, batch) {
  for (const item of batch) {
    void send(deviceId, protocol, item.raw_code, item.value, item.unit);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared simulation state
// ─────────────────────────────────────────────────────────────────────────────
const state = {
  // ── HL7 patient monitor vitals ───────────────────────────────────────────
  hr:          72,    // bpm   (MDC 149514)
  spo2:        98,    // %     (MDC 150456)
  pulseRate:   72,    // bpm   (MDC 149530)
  rr:          13,    // rpm   (MDC 151578)
  etco2Mmhg:   38,    // mmHg  (MDC 151872)  — monitor reports mmHg
  temp:        36.8,  // °C    (MDC 150344)

  // HL7 haemodynamic
  artSys:      118,   // mmHg  (MDC 150033)
  artDia:       65,   // mmHg  (MDC 150034)
  artMean:      83,   // mmHg  (MDC 150035)
  artPr:        72,   // bpm   (MDC 149522)
  cvp:           7,   // mmHg  (MDC 150087)

  // NIBP (HL7) — driven by NIBP cycle timer
  nibpSys:     118,   // mmHg  (MDC 150021)
  nibpDia:      65,   // mmHg  (MDC 150022)
  nibpMap:      83,   // mmHg  (MDC 150023)

  // ── GE750 ventilator measured ─────────────────────────────────────────────
  tvExp:       500,   // mL
  mvExp:       6.5,   // L/min
  rrVent:      12,    // rpm   (same breath rate as HL7 RR but sourced from vent)
  fio2:        40,    // %     (measured by vent O2 cell)
  ppeak:       22,    // cmH2O
  pplat:       18,    // cmH2O
  pmean:       10,    // cmH2O
  pmin:         1.2,  // cmH2O
  peepe:        5.0,  // cmH2O  extrinsic PEEP
  peepi:        0.4,  // cmH2O  intrinsic PEEP
  peepei:       5.4,  // cmH2O  total PEEP = peepe + peepi
  compliance:  36,    // mL/cmH2O
  raw:          8,    // cmH2O/L/s  airway resistance
  tvExpSpont:   0,    // mL    (zero in fully controlled mode)
  tvInsp:     500,    // mL    (≈ tvExp)
  mvInsp:       6.5,  // L/min
  mvSpont:      0,    // L/min (zero in VCV)
  rrSpont:      0,    // rpm
  tInspMeas:    1.4,  // s
  tExpMeas:     3.6,  // s

  // ── GE750 MGAS gas analysis ───────────────────────────────────────────────
  mgasFio2:    40,    // %  (MGAS optical FiO2, ≈ vent fio2)
  eto2:        33,    // %  (end-tidal O2)
  fico2:        0.04, // %  (inspired CO2 — near zero)
  etco2Pct:    5.0,   // %  — GE750 stores in %; 38 mmHg ≈ 5%
  rrco2:       12,    // rpm (RR from CO2 waveform)
  fiAA:         2.0,  // %  (inspired agent, sevoflurane)
  etAA:         1.55, // %  (end-tidal agent)
  mac:          1.02, // MAC
  agentId:     "Sevoflurane",
  fiAA2:        0.0,  // %  (2nd agent — none)
  etAA2:        0.0,
  agentId2:    "No Agent",
  fin2o:        0.0,  // %  (N2O off)
  etn2o:        0.0,

  // ── GE750 gas flows ───────────────────────────────────────────────────────
  flowO2:       1.5,  // L/min
  flowN2o:      0.0,
  flowAir:      0.7,  // L/min
  presO2:     410,    // kPa  (pipeline supply pressure)
  presN2o:    415,    // kPa
  presAir:    405,    // kPa

  // ── GE750 settings ────────────────────────────────────────────────────────
  ventMode:   "VCV",
  setTv:      500,    // mL
  setRr:       12,    // rpm
  setIeRatio:   0.5,  // ratio (1:2)
  setTpause:   10,    // %
  setPeep:      5.0,  // cmH2O
  setPeakLimit: 40,   // cmH2O
  setInspPres:  15,   // cmH2O (used in PCV/SIMV-PC)
  setFio2:     40,    // %
  setFgfTotal:  2.2,  // L/min
  setPsupp:    10,    // cmH2O (pressure support)
  setFlowTrig:  2.0,  // L/min
  setEndFlow:  25,    // %
  setTInsp:     1.4,  // s
};

// ─────────────────────────────────────────────────────────────────────────────
// Mode rotation (occasional — mirrors real clinical setting changes)
// ─────────────────────────────────────────────────────────────────────────────
function maybeRotateVentMode() {
  if (Math.random() < 0.06) {
    state.ventMode = VENT_MODES[randInt(0, VENT_MODES.length - 1)];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HL7 MONITOR — fast vitals  (every 5 s)
// ─────────────────────────────────────────────────────────────────────────────
setInterval(() => {
  state.hr       = driftInt(state.hr,       { min: 50, max: 140, maxStep: 3 });
  state.spo2     = driftInt(state.spo2,     { min: 90, max: 100, maxStep: 1 });
  state.pulseRate = clamp(state.hr + randInt(-2, 2), 48, 145);
  state.rr       = driftInt(state.rr,       { min: 8,  max: 28,  maxStep: 1 });
  state.etco2Mmhg = driftInt(state.etco2Mmhg, { min: 25, max: 55, maxStep: 1 });

  sendMany(MONITOR_DEVICE_ID, PROTO_HL7, [
    { raw_code: "149514", value: state.hr,        unit: "bpm"  }, // ECG HR
    { raw_code: "150456", value: state.spo2,      unit: "%"    }, // SpO2
    { raw_code: "149530", value: state.pulseRate, unit: "bpm"  }, // pleth pulse
    { raw_code: "151578", value: state.rr,        unit: "rpm"  }, // RR
    { raw_code: "151872", value: state.etco2Mmhg, unit: "mmHg" }, // EtCO2
  ]);
}, 5000);

// ─────────────────────────────────────────────────────────────────────────────
// HL7 MONITOR — arterial, CVP, temperature  (every 5 s)
// ─────────────────────────────────────────────────────────────────────────────
setInterval(() => {
  state.artMean = driftInt(state.artMean, { min: 55, max: 115, maxStep: 2 });
  const pp = randInt(38, 68);
  state.artSys  = clamp(Math.round(state.artMean + pp * 0.6), 80, 190);
  state.artDia  = clamp(Math.round(state.artMean - pp * 0.4), 35, 120);
  state.artPr   = clamp(state.hr + randInt(-3, 3), 48, 145);
  state.cvp     = driftInt(state.cvp, { min: 1, max: 18, maxStep: 1 });
  state.temp    = driftFloat(state.temp, { min: 35.5, max: 38.2, maxStep: 0.05, decimals: 1 });

  sendMany(MONITOR_DEVICE_ID, PROTO_HL7, [
    { raw_code: "150033", value: state.artSys,  unit: "mmHg" }, // ART sys
    { raw_code: "150034", value: state.artDia,  unit: "mmHg" }, // ART dia
    { raw_code: "150035", value: state.artMean, unit: "mmHg" }, // ART mean
    { raw_code: "149522", value: state.artPr,   unit: "bpm"  }, // ART pulse
    { raw_code: "150087", value: state.cvp,     unit: "mmHg" }, // CVP
    { raw_code: "150344", value: state.temp,    unit: "C"    }, // temperature
  ]);
}, 5000);

// ─────────────────────────────────────────────────────────────────────────────
// HL7 MONITOR — NIBP  (random 3–5 min cycle)
// ─────────────────────────────────────────────────────────────────────────────
function sendNIBP() {
  const sys = clamp(state.artSys + randInt(-10, 10), 80, 190);
  const dia = clamp(state.artDia + randInt(-7,  7),  35, 120);
  const map = Math.round((sys + 2 * dia) / 3);

  sendMany(MONITOR_DEVICE_ID, PROTO_HL7, [
    { raw_code: "150021", value: sys, unit: "mmHg" }, // NIBP sys
    { raw_code: "150022", value: dia, unit: "mmHg" }, // NIBP dia
    { raw_code: "150023", value: map, unit: "mmHg" }, // NIBP mean
  ]);

  setTimeout(sendNIBP, randFloat(3, 5) * 60 * 1000);
}
setTimeout(sendNIBP, 60 * 1000);   // first NIBP 1 min after start

// ─────────────────────────────────────────────────────────────────────────────
// GE750 — fast measured stream  (every 5 s)
//   Core ventilator parameters that change breath-by-breath
// ─────────────────────────────────────────────────────────────────────────────
setInterval(() => {
  state.rrVent  = driftInt(state.rrVent, { min: 8, max: 28, maxStep: 1 });
  state.tvExp   = driftInt(state.tvExp,  { min: 280, max: 900, maxStep: 8 });
  state.mvExp   = Number(clamp(state.tvExp * state.rrVent / 1000, 2.0, 18.0).toFixed(2));
  state.tvInsp  = clamp(state.tvExp + randInt(-15, 15), 260, 920);
  state.mvInsp  = Number(clamp(state.tvInsp * state.rrVent / 1000, 2.0, 18.0).toFixed(2));
  state.fio2    = driftInt(state.fio2, { min: 21, max: 100, maxStep: 1 });
  state.ppeak   = driftFloat(state.ppeak,  { min: 8, max: 44, maxStep: 0.8, decimals: 1 });
  state.pplat   = Number(clamp(state.ppeak - randFloat(2.5, 7.5), 5, 38).toFixed(1));
  state.pmean   = Number(clamp((state.ppeak + state.pplat) / 2 - randFloat(2, 5), 3, 28).toFixed(1));
  state.pmin    = Number(clamp(randFloat(0, 2.5), 0, 6).toFixed(1));

  sendMany(MACHINE_DEVICE_ID, PROTO_GE750, [
    { raw_code: "GE750_TIDAL_VOLUME_EXP",  value: state.tvExp,  unit: "mL" },
    { raw_code: "GE750_MINUTE_VOLUME_EXP", value: state.mvExp,  unit: "L/min" },
    { raw_code: "GE750_RESP_RATE",         value: state.rrVent, unit: "rpm" },
    { raw_code: "GE750_FIO2",              value: state.fio2,   unit: "%" },
    { raw_code: "GE750_PPEAK",             value: state.ppeak,  unit: "cmH2O" },
    { raw_code: "GE750_PPLAT",             value: state.pplat,  unit: "cmH2O" },
    { raw_code: "GE750_PMEAN",             value: state.pmean,  unit: "cmH2O" },
    { raw_code: "GE750_PMIN",              value: state.pmin,   unit: "cmH2O" },
    { raw_code: "GE750_TVINSP",            value: state.tvInsp, unit: "mL" },
    { raw_code: "GE750_MVINSP",            value: state.mvInsp, unit: "L/min" },
  ]);
}, 5000);

// ─────────────────────────────────────────────────────────────────────────────
// GE750 — extended measured + MGAS + flows  (every 10 s)
//   Mechanics, gas analysis, agent, gas flows, timing
// ─────────────────────────────────────────────────────────────────────────────
setInterval(() => {
  // Mechanics
  state.peepe      = driftFloat(state.peepe, { min: 3, max: 14, maxStep: 0.2, decimals: 1 });
  state.peepi      = driftFloat(state.peepi, { min: 0, max: 4,  maxStep: 0.1, decimals: 1 });
  state.peepei     = Number(clamp(state.peepe + state.peepi, 0, 18).toFixed(1));
  state.compliance = driftFloat(state.compliance, { min: 15, max: 65, maxStep: 1.0, decimals: 1 });
  state.raw        = driftFloat(state.raw,        { min: 3,  max: 25, maxStep: 0.5, decimals: 1 });

  // Spontaneous (small contribution in SIMV/CPAP modes, zero in VCV)
  const isSpont    = state.ventMode.includes("SIMV") || state.ventMode.includes("CPAP") || state.ventMode.includes("PSV");
  state.rrSpont    = isSpont ? driftInt(state.rrSpont, { min: 2, max: 16, maxStep: 2 }) : 0;
  state.tvExpSpont = isSpont ? driftInt(state.tvExpSpont, { min: 150, max: 450, maxStep: 15 }) : 0;
  state.mvSpont    = Number(clamp(state.tvExpSpont * state.rrSpont / 1000, 0, 10).toFixed(2));

  // Breath timing — insp + exp = 60/RR
  const cycleSec   = 60 / Math.max(8, state.rrVent);
  const ie         = state.setIeRatio;                      // eg 0.5 → I:E 1:2
  state.tInspMeas  = Number(clamp(cycleSec * ie / (1 + ie), 0.5, 5.0).toFixed(2));
  state.tExpMeas   = Number(clamp(cycleSec - state.tInspMeas, 1.0, 8.0).toFixed(2));

  // MGAS gas analysis
  state.mgasFio2   = clamp(state.fio2 + randInt(-2, 2), 21, 100);
  state.eto2       = clamp(Math.round(state.fio2 - randFloat(4, 12)), 15, 90);
  state.fico2      = driftFloat(state.fico2, { min: 0, max: 0.6,  maxStep: 0.02, decimals: 2 });
  state.etco2Pct   = driftFloat(state.etco2Pct, { min: 2.5, max: 7.0, maxStep: 0.12, decimals: 2 });
  state.rrco2      = clamp(state.rrVent + randInt(-1, 1), 6, 30);

  // Anesthetic agent (Sevoflurane)
  state.fiAA       = driftFloat(state.fiAA, { min: 0, max: 4.5, maxStep: 0.08, decimals: 2 });
  state.etAA       = Number(clamp(state.fiAA - randFloat(0.15, 0.55), 0, 4.2).toFixed(2));
  state.mac        = Number(clamp(state.etAA / 1.8, 0, 2.5).toFixed(2));   // sevo: 2% ≈ 1.1 MAC
  // 2nd agent stays at zero (no second agent mixed)
  state.fiAA2      = driftFloat(state.fiAA2, { min: 0, max: 0.3, maxStep: 0.01, decimals: 2 });
  state.etAA2      = Number(clamp(state.fiAA2 - randFloat(0, 0.06), 0, 0.28).toFixed(2));

  // N2O (off by default — small drift to simulate "off" state)
  state.fin2o      = driftFloat(state.fin2o, { min: 0, max: 1.5,  maxStep: 0.05, decimals: 2 });
  state.etn2o      = Number(clamp(state.fin2o - randFloat(0, 0.3), 0, 1.2).toFixed(2));

  // Gas flows
  state.flowO2     = driftFloat(state.flowO2, { min: 0.2, max: 8.0, maxStep: 0.08, decimals: 2 });
  state.flowN2o    = driftFloat(state.flowN2o, { min: 0,   max: 0.5, maxStep: 0.03, decimals: 2 });
  state.flowAir    = driftFloat(state.flowAir, { min: 0,   max: 8.0, maxStep: 0.08, decimals: 2 });

  // Supply pressures — very stable; occasional small drop
  state.presO2     = driftFloat(state.presO2,  { min: 360, max: 450, maxStep: 1.5, decimals: 0 });
  state.presN2o    = driftFloat(state.presN2o, { min: 360, max: 450, maxStep: 1.5, decimals: 0 });
  state.presAir    = driftFloat(state.presAir, { min: 360, max: 450, maxStep: 1.5, decimals: 0 });

  sendMany(MACHINE_DEVICE_ID, PROTO_GE750, [
    // Extended mechanics
    { raw_code: "GE750_PEEPE",        value: state.peepe,     unit: "cmH2O" },
    { raw_code: "GE750_PEEPI",        value: state.peepi,     unit: "cmH2O" },
    { raw_code: "GE750_PEEPEI",       value: state.peepei,    unit: "cmH2O" },
    { raw_code: "GE750_COMPLIANCE",   value: state.compliance, unit: "mL/cmH2O" },
    { raw_code: "GE750_RAW",          value: state.raw,        unit: "cmH2O/L/s" },
    { raw_code: "GE750_TVEXP_SPONT",  value: state.tvExpSpont, unit: "mL" },
    { raw_code: "GE750_MV_SPONT",     value: state.mvSpont,    unit: "L/min" },
    { raw_code: "GE750_RR_SPONT",     value: state.rrSpont,    unit: "rpm" },
    // Breath timing
    { raw_code: "GE750_TINSP_MEAS",   value: state.tInspMeas, unit: "s" },
    { raw_code: "GE750_TEXP_MEAS",    value: state.tExpMeas,  unit: "s" },
    // MGAS
    { raw_code: "GE750_MGAS_FIO2",    value: state.mgasFio2,   unit: "%" },
    { raw_code: "GE750_ETO2",         value: state.eto2,       unit: "%" },
    { raw_code: "GE750_FICO2",        value: state.fico2,      unit: "%" },  // % not mmHg
    { raw_code: "GE750_ETCO2",        value: state.etco2Pct,   unit: "%" },  // % not mmHg
    { raw_code: "GE750_RRCO2",        value: state.rrco2,      unit: "rpm" },
    { raw_code: "GE750_FIAA",         value: state.fiAA,       unit: "%" },
    { raw_code: "GE750_ETAA",         value: state.etAA,       unit: "%" },
    { raw_code: "GE750_AGENT_ID",     value: state.agentId,    unit: null },
    { raw_code: "GE750_FIAA_2ND",     value: state.fiAA2,      unit: "%" },
    { raw_code: "GE750_ETAA_2ND",     value: state.etAA2,      unit: "%" },
    { raw_code: "GE750_AGENT_ID_2ND", value: state.agentId2,   unit: null },
    { raw_code: "GE750_FIN2O",        value: state.fin2o,      unit: "%" },
    { raw_code: "GE750_ETN2O",        value: state.etn2o,      unit: "%" },
    { raw_code: "GE750_MAC",          value: state.mac,        unit: "MAC" },
    // Gas flows
    { raw_code: "GE750_FLOW_O2",      value: state.flowO2,  unit: "L/min" },
    { raw_code: "GE750_FLOW_N2O",     value: state.flowN2o, unit: "L/min" },
    { raw_code: "GE750_FLOW_AIR",     value: state.flowAir, unit: "L/min" },
    // Supply pipeline pressures
    { raw_code: "GE750_PRES_O2_SUPPLY",  value: state.presO2,  unit: "kPa" },
    { raw_code: "GE750_PRES_N2O_SUPPLY", value: state.presN2o, unit: "kPa" },
    { raw_code: "GE750_PRES_AIR_SUPPLY", value: state.presAir, unit: "kPa" },
  ]);
}, 10000);

// ─────────────────────────────────────────────────────────────────────────────
// GE750 — settings / targets  (every 30 s)
//   Mirrors VTq frame; includes vent mode and all set-point parameters
// ─────────────────────────────────────────────────────────────────────────────
setInterval(() => {
  maybeRotateVentMode();

  state.setTv        = clamp(state.tvExp  + randInt(-20, 20), 250, 950);
  state.setRr        = clamp(state.rrVent + randInt(-1,  1),  6,   30);
  state.setFio2      = clamp(state.fio2   + randInt(-1,  1),  21, 100);
  state.setFgfTotal  = Number(clamp(state.flowO2 + state.flowN2o + state.flowAir, 0.2, 14).toFixed(2));
  state.setPeep      = driftFloat(state.setPeep,  { min: 3, max: 15, maxStep: 0.3, decimals: 1 });
  state.setPeakLimit = driftFloat(state.setPeakLimit, { min: 25, max: 60, maxStep: 0.5, decimals: 0 });
  state.setInspPres  = driftFloat(state.setInspPres, { min: 8, max: 30, maxStep: 0.5, decimals: 1 });
  state.setPsupp     = driftFloat(state.setPsupp,    { min: 5, max: 20, maxStep: 0.3, decimals: 1 });
  state.setIeRatio   = driftFloat(state.setIeRatio,  { min: 0.33, max: 0.67, maxStep: 0.01, decimals: 2 });
  state.setTInsp     = Number(clamp(60 / Math.max(8, state.setRr) * state.setIeRatio / (1 + state.setIeRatio), 0.5, 4.0).toFixed(2));

  sendMany(MACHINE_DEVICE_ID, PROTO_GE750, [
    { raw_code: "GE750_VENT_MODE",         value: state.ventMode,    unit: null },
    { raw_code: "GE750_SET_TV",            value: state.setTv,       unit: "mL" },
    { raw_code: "GE750_SET_RR",            value: state.setRr,       unit: "rpm" },
    { raw_code: "GE750_SET_IE_RATIO",      value: state.setIeRatio,  unit: "ratio" },
    { raw_code: "GE750_SET_TPAUSE",        value: state.setTpause,   unit: "%" },
    { raw_code: "GE750_SET_PEEP",          value: state.setPeep,     unit: "cmH2O" },
    { raw_code: "GE750_SET_PEAK_LIMIT",    value: state.setPeakLimit, unit: "cmH2O" },
    { raw_code: "GE750_SET_INSP_PRESSURE", value: state.setInspPres, unit: "cmH2O" },
    { raw_code: "GE750_SET_FIO2",          value: state.setFio2,     unit: "%" },
    { raw_code: "GE750_SET_FGF_TOTAL",     value: state.setFgfTotal, unit: "L/min" },
    { raw_code: "GE750_SET_PSUPP",         value: state.setPsupp,    unit: "cmH2O" },
    { raw_code: "GE750_SET_FLOW_TRIGGER",  value: state.setFlowTrig, unit: "L/min" },
    { raw_code: "GE750_SET_END_FLOW",      value: state.setEndFlow,  unit: "%" },
    { raw_code: "GE750_SET_T_INSP",        value: state.setTInsp,    unit: "s" },
  ]);
}, 30000);

console.log(
  `[LIVEAGENT] started\n` +
  `  monitor  → ${MONITOR_DEVICE_ID} (protocol: ${PROTO_HL7})\n` +
  `  machine  → ${MACHINE_DEVICE_ID} (protocol: ${PROTO_GE750})\n` +
  `  target   → ${IVY_URL}`,
);
