const db = require("./db");

function auditUnknown(protocol, rawKey) {
  const now = Date.now();

  db.run(
    `
    INSERT INTO unknown_params
      (protocol, raw_code, first_seen, last_seen, seen_count)
    VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(protocol, raw_code)
    DO UPDATE SET
      last_seen = excluded.last_seen,
      seen_count = seen_count + 1
    `,
    [protocol, rawKey, now, now]
  );
}

module.exports = { auditUnknown };
