const express = require("express");
const { db } = require("./floradb");

const router = express.Router();

const insertDailyCase = db.prepare(
  `INSERT OR REPLACE INTO ephis_daily_case (
      hn, admit_date, admit_datetime, raw_admit_value, source_payload, imported_at
    ) VALUES (?, ?, ?, ?, ?, ?)`
);

const clearDailyCases = db.prepare(`DELETE FROM ephis_daily_case`);

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function splitTsvLine(line) {
  return String(line || "").replace(/\r$/, "").split("\t");
}

function parseDateValue(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;

  const isoDate = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDate) {
    return {
      admitDate: `${isoDate[1]}-${isoDate[2]}-${isoDate[3]}`,
      admitDateTime: null,
    };
  }

  const usDateTime = text.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (usDateTime) {
    const month = usDateTime[1].padStart(2, "0");
    const day = usDateTime[2].padStart(2, "0");
    const year = usDateTime[3];
    const hour = (usDateTime[4] || "00").padStart(2, "0");
    const minute = (usDateTime[5] || "00").padStart(2, "0");
    const second = (usDateTime[6] || "00").padStart(2, "0");
    return {
      admitDate: `${year}-${month}-${day}`,
      admitDateTime: usDateTime[4]
        ? `${year}-${month}-${day}T${hour}:${minute}:${second}`
        : null,
    };
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  const hour = String(parsed.getHours()).padStart(2, "0");
  const minute = String(parsed.getMinutes()).padStart(2, "0");
  const second = String(parsed.getSeconds()).padStart(2, "0");

  return {
    admitDate: `${year}-${month}-${day}`,
    admitDateTime: `${year}-${month}-${day}T${hour}:${minute}:${second}`,
  };
}

function parseDailyCaseTsv(tsvText) {
  const lines = String(tsvText || "")
    .split(/\n/)
    .map(line => line.replace(/\r$/, ""))
    .filter(line => line.trim().length > 0);

  if (lines.length < 2) {
    throw new Error("TSV must include a header row and at least one data row");
  }

  const headers = splitTsvLine(lines[0]);
  const headerMap = new Map(headers.map((header, index) => [normalizeHeader(header), index]));

  const hnIndex =
    headerMap.get("hn") ??
    headerMap.get("patid") ??
    headerMap.get("patientid");
  const admitDateIndex =
    headerMap.get("admitdate") ??
    headerMap.get("admitdatetime") ??
    headerMap.get("admitdt");

  if (hnIndex == null) {
    throw new Error("Missing HN column. Expected one of: hn, patid, patientid");
  }
  if (admitDateIndex == null) {
    throw new Error("Missing admit date column. Expected one of: admit_date, admit_datetime, admitDate");
  }

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const values = splitTsvLine(lines[i]);
    const hn = String(values[hnIndex] || "").trim();
    const rawAdmitValue = String(values[admitDateIndex] || "").trim();
    if (!hn || !rawAdmitValue) continue;

    const parsedDate = parseDateValue(rawAdmitValue);
    if (!parsedDate) {
      throw new Error(`Unable to parse admit date on row ${i + 1}: ${rawAdmitValue}`);
    }

    const payload = {};
    headers.forEach((header, index) => {
      payload[header] = values[index] ?? "";
    });

    rows.push({
      hn,
      admitDate: parsedDate.admitDate,
      admitDateTime: parsedDate.admitDateTime,
      rawAdmitValue,
      sourcePayload: payload,
    });
  }

  if (rows.length === 0) {
    throw new Error("No valid daily case rows found in TSV");
  }

  return rows;
}

router.get("/import-status", (req, res) => {
  const summary = db
    .prepare(
      `SELECT
         COUNT(*) AS total_rows,
         MIN(admit_date) AS first_admit_date,
         MAX(admit_date) AS last_admit_date,
         MAX(imported_at) AS last_imported_at
       FROM ephis_daily_case`,
    )
    .get();

  res.json({
    total_rows: Number(summary?.total_rows || 0),
    first_admit_date: summary?.first_admit_date || null,
    last_admit_date: summary?.last_admit_date || null,
    last_imported_at: summary?.last_imported_at ? Number(summary.last_imported_at) : null,
  });
});

router.get("/daily-summary", (req, res) => {
  const from = String(req.query.from || "").trim();
  const to = String(req.query.to || "").trim();
  const rows = db
    .prepare(
      `SELECT admit_date, COUNT(*) AS case_count
       FROM ephis_daily_case
       WHERE (? = '' OR admit_date >= ?)
         AND (? = '' OR admit_date <= ?)
       GROUP BY admit_date
       ORDER BY admit_date DESC`,
    )
    .all(from, from, to, to)
    .map(row => ({
      admit_date: String(row.admit_date || ""),
      case_count: Number(row.case_count || 0),
    }));

  res.json({ rows });
});

router.get("/daily-cases", (req, res) => {
  const admitDate = String(req.query.admit_date || "").trim();
  const hnQuery = String(req.query.hn || "").trim().toLowerCase();

  const rows = db
    .prepare(
      `SELECT hn, admit_date, admit_datetime, raw_admit_value
       FROM ephis_daily_case
       WHERE (? = '' OR admit_date = ?)
         AND (? = '' OR lower(hn) LIKE ?)
       ORDER BY admit_date DESC, COALESCE(admit_datetime, admit_date) DESC, hn ASC`,
    )
    .all(admitDate, admitDate, hnQuery, hnQuery ? `%${hnQuery}%` : "")
    .map(row => ({
      hn: String(row.hn || ""),
      admit_date: String(row.admit_date || ""),
      admit_datetime: row.admit_datetime ? String(row.admit_datetime) : null,
      raw_admit_value: row.raw_admit_value ? String(row.raw_admit_value) : null,
    }));

  res.json({ rows });
});

router.post("/import-daily-cases", (req, res) => {
  const tsvText = String(req.body?.tsvText || "");
  const replaceExisting = req.body?.replaceExisting !== false;

  try {
    const rows = parseDailyCaseTsv(tsvText);
    const importedAt = Date.now();

    const tx = db.transaction(() => {
      if (replaceExisting) {
        clearDailyCases.run();
      }

      for (const row of rows) {
        insertDailyCase.run(
          row.hn,
          row.admitDate,
          row.admitDateTime,
          row.rawAdmitValue,
          JSON.stringify(row.sourcePayload),
          importedAt,
        );
      }
    });

    tx();

    const summary = db
      .prepare(
        `SELECT
           COUNT(*) AS total_rows,
           MIN(admit_date) AS first_admit_date,
           MAX(admit_date) AS last_admit_date
         FROM ephis_daily_case`,
      )
      .get();

    res.json({
      ok: true,
      imported_rows: rows.length,
      total_rows: Number(summary?.total_rows || 0),
      first_admit_date: summary?.first_admit_date || null,
      last_admit_date: summary?.last_admit_date || null,
      imported_at: importedAt,
    });
  } catch (err) {
    res.status(400).json({ error: err?.message || "import failed" });
  }
});

module.exports = router;
