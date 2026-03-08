// hl7Parser.js — GE-safe, dumb-on-purpose, WORKS

function normalizeHL7(raw) {
  if (!raw) return "";

  return raw
    .replace(/\r\n/g, "\r")
    .replace(/\n/g, "\r")
    // 🔥 FIX: force CR before known segments
    .replace(/(\|)(OBR\|)/g, "\r$2")
    .replace(/(\|)(OBX\|)/g, "\r$2")
    .trim();
}

function parseHL7(message) {
  const normalized = normalizeHL7(message);

  const lines = normalized
    .split("\r")
    .map(l => l.trim())
    .filter(Boolean);

  const result = {
    msh: null,
    obr: null,
    obx: []
  };

  for (const line of lines) {
    const fields = line.split("|");
    const seg = fields[0];

    if (seg === "MSH") {
      result.msh = {
        sendingApp: fields[2] || null,
        sendingFacility: fields[3] || null,
        timestamp: fields[6] || null,
        messageType: fields[8] || null,
        controlId: fields[9] || null,
        version: fields[11] || null
      };
    }

    if (seg === "OBR") {
      result.obr = {
        placerOrderNumber: fields[2] || null,
        fillerOrderNumber: fields[3] || null
      };
    }

    if (seg === "OBX") {
      const obsId = fields[3] || "";
      const unit = fields[6] || "";

      result.obx.push({
        raw_code: obsId.split("^")[0] || null,
        obs_text: obsId.split("^")[1] || null,
        value: fields[5] ?? null,
        unit_code: unit.split("^")[0] || null,
        unit_text: unit.split("^")[1] || null,
        status: fields[11] || null
      });
    }
  }

  return result;
}

module.exports = { parseHL7 };
