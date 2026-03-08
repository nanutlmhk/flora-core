const db = require("./db");
const { lookupAlias, normalizeRaw } = require("./aliasLookup");
const { auditUnknown } = require("./unknownAudit");
const { emitIvyPayload } = require("./emitter");
const SKIP_ZERO_VALUES = String(process.env.IVY_HL7_SKIP_ZERO || "1") === "1";

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function resolveAlias(rawCode, obsText) {
  const direct = await lookupAlias("hl7", rawCode);
  if (direct) {
    return {
      alias: direct,
      matched_by: "raw_code",
      matched_key: normalizeRaw(rawCode),
    };
  }

  if (obsText) {
    const byText = await lookupAlias("hl7", obsText);
    if (byText) {
      return {
        alias: byText,
        matched_by: "obs_text",
        matched_key: normalizeRaw(obsText),
      };
    }
  }

  return null;
}

function handleOBX(obx, deviceId) {
  if (!obx || !obx.raw_code) {
    console.warn("[HL7] OBX skipped: invalid object", obx);
    return;
  }

  const rawCode = normalizeRaw(obx.raw_code);
  const obsText = normalizeRaw(obx.obs_text || "");
  const unitText = normalizeRaw(obx.unit_text || "");
  const rawValue = obx.value;

  if (rawValue === null || rawValue === "" || rawValue === undefined) {
    console.warn("[HL7] OBX skipped: empty value", rawCode);
    return;
  }

  const numericValue = toNumber(rawValue);
  if (numericValue == null) {
    console.warn("[HL7] OBX skipped: non-numeric value", rawCode, rawValue);
    return;
  }
  if (SKIP_ZERO_VALUES && numericValue === 0) {
    console.warn("[HL7] OBX skipped: zero value", rawCode);
    return;
  }

  void resolveAlias(rawCode, obsText)
    .then((resolved) => {
      if (!resolved) {
        auditUnknown("hl7", rawCode);
        console.warn(
          `[HL7] NO ALIAS FOUND: ${rawCode} | name=${obsText || "-"} | unit=${unitText || "-"}`,
        );
        return;
      }

      const { alias, matched_by, matched_key } = resolved;
      const systemTs = Date.now();
      const deviceTs = null;
      const finalUnit = alias.unit || obx.unit_code || obx.unit_text || null;

      console.log(
        `[HL7] OBX mapped (${matched_by}:${matched_key}): ${rawCode} -> ${alias.ivy_param} = ${numericValue} ${finalUnit || ""}`.trim(),
      );

      db.run(
        `
        INSERT INTO ivy_observations (
          device_id,
          source,
          protocol,
          raw_code,
          ivy_param,
          value,
          unit,
          system_ts,
          device_ts,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          deviceId || null,
          "hl7",
          "hl7",
          rawCode,
          alias.ivy_param,
          numericValue,
          finalUnit,
          systemTs,
          deviceTs,
          systemTs,
        ],
        function onInsert(insertErr) {
          if (insertErr) {
            console.error("[HL7] insert failed:", insertErr.message);
            return;
          }

          console.log("[HL7] IVY insert OK, rowid =", this.lastID);
        },
      );

      emitIvyPayload({
        source: deviceId || "hl7-monitor",
        system_ts: systemTs,
        device_ts: deviceTs,
        params: {
          [alias.ivy_param]: {
            value: numericValue,
            unit: finalUnit,
          },
        },
      });
    })
    .catch((err) => {
      console.error("[HL7] OBX handler error:", err?.message || err);
    });
}

module.exports = { handleOBX };
