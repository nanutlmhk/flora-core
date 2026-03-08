const db = require("./db");

function normalizeRaw(raw) {
  let value = String(raw || "").trim();

  // GE exports often use "Label:{0} unit" or similar placeholders.
  value = value.replace(/:\s*\{[^}]*\}.*$/u, "");

  // Collapse whitespace and normalize case for stable lookups.
  value = value.replace(/\s+/g, " ").trim().toUpperCase();

  return value;
}

function lookupAlias(protocol, raw_code) {
  const rawKey = normalizeRaw(raw_code);

  return new Promise((resolve) => {
    db.get(
      `
      SELECT ivy_param, unit
      FROM parameter_aliases
      WHERE protocol = ? AND raw_code = ?
      `,
      [protocol, rawKey],
      (err, row) => {
        if (row) return resolve({ ...row, rawKey });

        db.get(
          `
          SELECT ivy_param, unit
          FROM parameter_aliases
          WHERE protocol = '*' AND raw_code = ?
          `,
          [rawKey],
          (err2, row2) => {
            if (row2) return resolve({ ...row2, rawKey });

            resolve(null);
          }
        );
      }
    );
  });
}

module.exports = { lookupAlias, normalizeRaw };
