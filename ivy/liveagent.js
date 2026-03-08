const IVY_URL = process.env.IVY_MOCK_URL || "http://localhost:3000/mock/device";
const MONITOR_DEVICE_ID = process.env.LIVEAGENT_MONITOR_DEVICE_ID || "LIVEAGENT_HL7_01";
const MACHINE_DEVICE_ID = process.env.LIVEAGENT_MACHINE_DEVICE_ID || "LIVEAGENT_GE750_01";
const VERBOSE = process.env.LIVEAGENT_VERBOSE !== "0";

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
  const next = current + randInt(-maxStep, maxStep);
  return clamp(Math.round(next), min, max);
}

function driftFloat(current, { min, max, maxStep, decimals = 1 }) {
  const next = current + randFloat(-maxStep, maxStep);
  const bounded = clamp(next, min, max);
  return Number(bounded.toFixed(decimals));
}

async function send(deviceId, raw_code, value, unit) {
  const payload = {
    deviceId,
    raw_code,
    value,
    unit,
    device_ts: Date.now(),
  };

  try {
    const res = await fetch(IVY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    if (VERBOSE) {
      console.log("[LIVEAGENT] sent", payload, `status=${res.status}`, text);
    }
  } catch (e) {
    console.error("[LIVEAGENT] ERROR", e.message);
  }
}

function sendMany(deviceId, batch) {
  for (const item of batch) {
    void send(deviceId, item.raw_code, item.value, item.unit);
  }
}

const state = {
  hr: 74,
  pr: 74,
  spo2: 98,
  rr: 12,
  etco2: 34,
  fio2: 50,
  eto2: 43,
  fico2: 0.1,
  etco2Pct: 4.6,
  fin2o: 0,
  etn2o: 0,

  artSys: 122,
  artMap: 87,
  artDia: 68,
  cvp: 7,

  tvExp: 500,
  mvExp: 6.0,
  compliance: 32,
  peepIntrinsic: 0.5,
  peepExtrinsic: 5.0,
  peepTotal: 5.5,
  ppeak: 24,
  pplat: 18,
  pmean: 11,
  pmin: 1,

  fiAA: 1.8,
  etAA: 1.3,
  fiAA2: 0,
  etAA2: 0,
  mac: 1.0,

  oxygenFlow: 1.2,
  n2oFlow: 0.4,
  airFlow: 0.6,
  totalFreshGasFlow: 2.2,
  sevoFlow: 10,
  agentId: "Sevoflurane",
  agentId2: "No Agent",
  ventMode: "VCV",
};

const VENT_MODES = ["VCV", "PCV", "SIMV", "PSV"];

function maybeRotateVentMode() {
  // Keep mode mostly stable, but occasionally switch to mimic real setting changes.
  if (Math.random() < 0.08) {
    state.ventMode = VENT_MODES[randInt(0, VENT_MODES.length - 1)];
  }
}

/* =========================
   FAST STREAM (every 5 sec)
   ========================= */
setInterval(() => {
  state.hr = driftInt(state.hr, { min: 48, max: 145, maxStep: 3 });
  state.pr = clamp(state.hr + randInt(-2, 2), 45, 150);
  state.spo2 = driftInt(state.spo2, { min: 90, max: 100, maxStep: 1 });
  state.rr = driftInt(state.rr, { min: 8, max: 28, maxStep: 1 });
  state.etco2 = driftInt(state.etco2, { min: 20, max: 55, maxStep: 1 });

  sendMany(MONITOR_DEVICE_ID, [
    { raw_code: "HR", value: state.hr, unit: "bpm" },
    { raw_code: "PR", value: state.pr, unit: "bpm" },
    { raw_code: "SPO2", value: state.spo2, unit: "%" },
    { raw_code: "RR", value: state.rr, unit: "/min" },
    { raw_code: "ETCO2", value: state.etco2, unit: "mmHg" },
  ]);
}, 5000);

/* =========================
   ARTERIAL + CVP (every 5 sec)
   ========================= */
setInterval(() => {
  state.artMap = driftInt(state.artMap, { min: 55, max: 120, maxStep: 2 });
  const pulsePressure = randInt(32, 62);
  state.artSys = clamp(Math.round(state.artMap + pulsePressure / 2), 80, 190);
  state.artDia = clamp(Math.round(state.artMap - pulsePressure / 2), 35, 120);
  state.cvp = driftInt(state.cvp, { min: 1, max: 20, maxStep: 1 });

  sendMany(MONITOR_DEVICE_ID, [
    { raw_code: "ART SYS", value: state.artSys, unit: "mmHg" },
    { raw_code: "ART MAP", value: state.artMap, unit: "mmHg" },
    { raw_code: "ART DIA", value: state.artDia, unit: "mmHg" },
    { raw_code: "CVP", value: state.cvp, unit: "mmHg" },
  ]);
}, 5000);

/* =========================
   ANESTHETIC AGENT (every 10 sec)
   ========================= */
setInterval(() => {
  state.fio2 = driftFloat(state.fio2, {
    min: 30,
    max: 100,
    maxStep: 1.5,
    decimals: 1,
  });
  state.fiAA = driftFloat(state.fiAA, {
    min: 0,
    max: 4.5,
    maxStep: 0.08,
    decimals: 2,
  });

  const uptakeDrop = randFloat(0.15, 0.55);
  state.etAA = Number(clamp(state.fiAA - uptakeDrop, 0, 4.2).toFixed(2));
  state.mac = Number(clamp(state.etAA / 1.2, 0, 2.5).toFixed(2));
  state.etco2Pct = driftFloat(state.etco2Pct, {
    min: 2.5,
    max: 7.0,
    maxStep: 0.12,
    decimals: 2,
  });
  state.fico2 = driftFloat(state.fico2, {
    min: 0.0,
    max: 0.8,
    maxStep: 0.03,
    decimals: 2,
  });
  state.eto2 = Number(clamp(state.fio2 - randFloat(2.0, 10.0), 15, 95).toFixed(1));
  state.fin2o = driftFloat(state.fin2o, {
    min: 0,
    max: 70,
    maxStep: 1.8,
    decimals: 1,
  });
  state.etn2o = Number(clamp(state.fin2o - randFloat(0.5, 4.0), 0, 70).toFixed(1));
  state.fiAA2 = driftFloat(state.fiAA2, {
    min: 0,
    max: 0.4,
    maxStep: 0.02,
    decimals: 2,
  });
  state.etAA2 = Number(clamp(state.fiAA2 - randFloat(0, 0.08), 0, 0.35).toFixed(2));
  state.oxygenFlow = driftFloat(state.oxygenFlow, {
    min: 0.2,
    max: 8,
    maxStep: 0.08,
    decimals: 2,
  });
  state.n2oFlow = driftFloat(state.n2oFlow, {
    min: 0,
    max: 6,
    maxStep: 0.08,
    decimals: 2,
  });
  state.airFlow = driftFloat(state.airFlow, {
    min: 0,
    max: 8,
    maxStep: 0.08,
    decimals: 2,
  });
  state.totalFreshGasFlow = Number(
    clamp(state.oxygenFlow + state.n2oFlow + state.airFlow, 0, 14).toFixed(2),
  );
  state.sevoFlow = driftFloat(state.sevoFlow, {
    min: 0,
    max: 45,
    maxStep: 0.8,
    decimals: 1,
  });

  sendMany(MACHINE_DEVICE_ID, [
    { raw_code: "Measured FiO2 Conc FiO2:{0} %", value: state.fio2, unit: "%" },
    { raw_code: "Measured Fi Anesthetic Agent Conc FiAA:{0} %", value: state.fiAA, unit: "%" },
    { raw_code: "Measured End Tidal Anesthetic Agent Conc EtAA:{0} %", value: state.etAA, unit: "%" },
    { raw_code: "Measured MAC:{0}", value: state.mac, unit: "ratio" },
    { raw_code: "Anesthetic Agent ID", value: state.agentId, unit: null },
    { raw_code: "Secondary Anesthetic Agent ID", value: state.agentId2, unit: null },
  ]);
}, 10000);

/* =========================
   GE750-LIKE MEASURED STREAM (every 10 sec)
   ========================= */
setInterval(() => {
  state.tvExp = driftInt(state.tvExp, { min: 250, max: 900, maxStep: 6 });
  state.mvExp = Number(clamp(state.tvExp * state.rr / 1000, 2.0, 20.0).toFixed(2));
  state.compliance = driftFloat(state.compliance, {
    min: 12,
    max: 65,
    maxStep: 1.2,
    decimals: 1,
  });
  state.peepExtrinsic = driftFloat(state.peepExtrinsic, {
    min: 3,
    max: 8,
    maxStep: 0.2,
    decimals: 1,
  });
  state.peepIntrinsic = driftFloat(state.peepIntrinsic, {
    min: 0,
    max: 3,
    maxStep: 0.15,
    decimals: 1,
  });
  state.peepTotal = Number(clamp(state.peepExtrinsic + state.peepIntrinsic, 0, 12).toFixed(1));
  state.ppeak = driftFloat(state.ppeak, {
    min: 8,
    max: 45,
    maxStep: 0.8,
    decimals: 1,
  });
  state.pplat = Number(clamp(state.ppeak - randFloat(2.0, 8.0), 5, 38).toFixed(1));
  state.pmean = Number(clamp((state.ppeak + state.pplat) / 2 - randFloat(2, 5), 3, 30).toFixed(1));
  state.pmin = Number(clamp(randFloat(0, 3), 0, 8).toFixed(1));

  sendMany(MACHINE_DEVICE_ID, [
    { raw_code: "Measured Expired Tidal Volume:{0} mL", value: state.tvExp, unit: "mL" },
    {
      raw_code: "Measured Total Expired Minute Volume:{0} L",
      value: state.mvExp,
      unit: "L/min",
    },
    { raw_code: "Measured Total Respiratory rate:{0} /min", value: state.rr, unit: "rpm" },
    { raw_code: "Maximum Positive Pressure Ppeak:{0} cm H2O", value: state.ppeak, unit: "cmH2O" },
    { raw_code: "Measured Plateau Pressure Pplat:{0} cm H2O", value: state.pplat, unit: "cmH2O" },
    { raw_code: "Measured Mean Pressure Pmean:{0} cm H2O", value: state.pmean, unit: "cmH2O" },
    { raw_code: "Measured Minimum Pressure Pmin:{0} cm H2O", value: state.pmin, unit: "cmH2O" },
    { raw_code: "Measured Compliance:{0} mL/cm H2O", value: state.compliance, unit: "mL/cmH2O" },
    { raw_code: "Measured Instrinsic PEEP:{0} cm H2O", value: state.peepIntrinsic, unit: "cmH2O" },
    { raw_code: "Measured Extrinsic PEEP:{0} cm H2O", value: state.peepExtrinsic, unit: "cmH2O" },
    { raw_code: "Measured Total PEEP PEEPei:{0} cm H2O", value: state.peepTotal, unit: "cmH2O" },
    { raw_code: "Measured FiO2 Conc FiO2:{0} %", value: state.fio2, unit: "%" },
    { raw_code: "Measured End Tidal O2 Conc EtO2:{0} %", value: state.eto2, unit: "%" },
    { raw_code: "Measured FiO2 Conc FiCO2:{0} %", value: state.fico2, unit: "%" },
    { raw_code: "Measured End Tidal CO2 Conc EtCO2:{0} %", value: state.etco2Pct, unit: "%" },
    { raw_code: "Measured Fi Anesthetic Agent Conc FiAA:{0} %", value: state.fiAA, unit: "%" },
    { raw_code: "Measured End Tidal Anesthetic Agent Conc EtAA:{0} %", value: state.etAA, unit: "%" },
    {
      raw_code: "Measured Secondary Fi Anesthetic Agent Conc FiAA:{0} %",
      value: state.fiAA2,
      unit: "%",
    },
    {
      raw_code: "Measured Secondary End Tidal Anesthetic Agent Conc EtAA:{0} %",
      value: state.etAA2,
      unit: "%",
    },
    { raw_code: "Measured Fi N2O Conc FiN2O:{0} %", value: state.fin2o, unit: "%" },
    { raw_code: "Measured End Tidal N2O Conc EtN2O:{0} %", value: state.etn2o, unit: "%" },
    { raw_code: "Measured MAC:{0}", value: state.mac, unit: "ratio" },
    { raw_code: "Measured Oxygen Flow Rate:{0} L/min", value: state.oxygenFlow, unit: "L/min" },
    { raw_code: "Measured N2O Flow Rate:{0} L/min", value: state.n2oFlow, unit: "L/min" },
    { raw_code: "Measured Air Flow Rate:{0} L/min", value: state.airFlow, unit: "L/min" },
    { raw_code: "Measured Sevoflurane Flow Rate:{0} ml/hr", value: state.sevoFlow, unit: "ml/hr" },
  ]);
}, 10000);

/* =========================
   GE750-LIKE SET/TARGET STREAM (every 30 sec)
   ========================= */
setInterval(() => {
  maybeRotateVentMode();

  sendMany(MACHINE_DEVICE_ID, [
    { raw_code: "Set Total Fresh Gas Flow:{0} L/min", value: state.totalFreshGasFlow, unit: "L/min" },
    { raw_code: "Set Target FiO2 Conc FiO2:{0} %", value: state.fio2, unit: "%" },
    { raw_code: "Set Target FiAA Concentration:{0} %", value: state.fiAA, unit: "%" },
    { raw_code: "Set Target EtAA Concentration:{0} %", value: state.etAA, unit: "%" },
    { raw_code: "Ventilation Mode", value: state.ventMode, unit: "mode" },
  ]);
}, 30000);

/* =========================
   NIBP CYCLE (every 3-5 min)
   ========================= */
function sendNIBP() {
  const sys = clamp(state.artSys + randInt(-8, 8), 80, 190);
  const dia = clamp(state.artDia + randInt(-6, 6), 35, 120);
  const map = Math.round((sys + 2 * dia) / 3);

  sendMany(MONITOR_DEVICE_ID, [
    { raw_code: "NIBP SYS", value: sys, unit: "mmHg" },
    { raw_code: "NIBP DIA", value: dia, unit: "mmHg" },
    { raw_code: "NIBP MAP", value: map, unit: "mmHg" },
  ]);

  const nextMs = randFloat(3, 5) * 60 * 1000;
  setTimeout(sendNIBP, nextMs);
}

setTimeout(sendNIBP, 60 * 1000);

console.log(
  `[LIVEAGENT] started monitor=${MONITOR_DEVICE_ID} machine=${MACHINE_DEVICE_ID} target=${IVY_URL}`,
);
