#!/usr/bin/env node
/**
 * test-files.js — Diagnostic for AS3ExportData.csv and AS3Rawoutput1.raw
 *
 * Usage:
 *   node ivy/ges5/test-files.js
 *
 * Reports what data each file contains and whether the parsers decode it correctly.
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const { unescapePacket, computeChecksum } = require("./framing");
const { parsePhdbPacket } = require("./index");

const CSV_PATH = path.join(__dirname, "AS3ExportData.csv");
const RAW_PATH = path.join(__dirname, "AS3Rawoutput1.raw");

// ─── CSV ──────────────────────────────────────────────────────────────────────

function parseAS3CSV(filePath) {
  const text    = fs.readFileSync(filePath, "utf8");
  const lines   = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // Line 0 = software, Line 1 = device, Line 2 = headers, Line 3+ = data
  if (lines.length < 3) {
    console.error("[CSV] File has fewer than 3 lines — cannot parse.");
    return null;
  }

  const software = lines[0];
  const device   = lines[1];
  const headers  = lines[2].split(",").map(h => h.trim());
  const dataLines = lines.slice(3);

  console.log("=".repeat(70));
  console.log("CSV FILE: " + path.basename(filePath));
  console.log("=".repeat(70));
  console.log("  Software : " + software);
  console.log("  Device   : " + device);
  console.log("  Columns  : " + headers.length);
  console.log("  Data rows: " + dataLines.length);

  const rows = [];
  for (const line of dataLines) {
    const cols = line.split(",");
    const date = cols[0]?.trim();
    const time = cols[1]?.trim();
    if (!date || !time) continue;

    // "3/4/2026,12:32:02 PM" → JS Date
    const tsMs = Date.parse(`${date} ${time}`);
    const ts   = Number.isFinite(tsMs) ? new Date(tsMs).toISOString() : `${date} ${time}`;

    const params = {};
    for (let j = 2; j < headers.length && j < cols.length; j++) {
      const raw = cols[j]?.trim();
      if (!raw || raw === "-" || raw === "None" || raw === "") continue;
      const num = Number(raw);
      params[headers[j]] = Number.isFinite(num) ? num : raw;
    }

    rows.push({ ts, params });
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const paramCount = {}; // param → count of non-null rows
  const paramMin   = {};
  const paramMax   = {};

  for (const row of rows) {
    for (const [k, v] of Object.entries(row.params)) {
      paramCount[k] = (paramCount[k] || 0) + 1;
      if (typeof v === "number") {
        if (paramMin[k] === undefined || v < paramMin[k]) paramMin[k] = v;
        if (paramMax[k] === undefined || v > paramMax[k]) paramMax[k] = v;
      }
    }
  }

  console.log("\nParameter presence across " + rows.length + " rows:");
  const sorted = Object.entries(paramCount).sort((a, b) => b[1] - a[1]);
  for (const [k, cnt] of sorted) {
    const pct  = ((cnt / rows.length) * 100).toFixed(0).padStart(3) + "%";
    const range = (paramMin[k] !== undefined)
      ? `  range: ${paramMin[k]} – ${paramMax[k]}`
      : "";
    console.log(`  ${pct}  (${String(cnt).padStart(3)}/${rows.length})  ${k}${range}`);
  }

  // ── First 5 rows with data ─────────────────────────────────────────────────
  console.log("\nFirst 5 rows:");
  for (const row of rows.slice(0, 5)) {
    const p = Object.keys(row.params).length;
    const line = Object.entries(row.params)
      .slice(0, 8)
      .map(([k, v]) => `${k}=${v}`)
      .join("  ");
    console.log(`  ${row.ts}  [${p} params]  ${line || "(no data)"}`);
  }

  return rows;
}

// ─── Raw binary ───────────────────────────────────────────────────────────────

const FLAG = 0x7e;

function extractFrames(buf) {
  const frames = [];
  let i = 0;

  while (i < buf.length) {
    const start = buf.indexOf(FLAG, i);
    if (start === -1) break;

    const end = buf.indexOf(FLAG, start + 1);
    if (end === -1) break;

    const frame = buf.slice(start + 1, end);
    i = end; // end flag becomes start of next frame

    if (frame.length === 0) continue;
    frames.push(frame);
  }

  return frames;
}

function parseRawFile(filePath) {
  const buf = fs.readFileSync(filePath);

  console.log("\n" + "=".repeat(70));
  console.log("RAW FILE: " + path.basename(filePath));
  console.log("=".repeat(70));
  console.log("  File size: " + buf.length + " bytes");

  const frames = extractFrames(buf);
  console.log("  Frames found (0x7E pairs): " + frames.length);

  let goodPkts = 0, badChk = 0, shortPkts = 0;
  const phdbResults = [];

  for (const frame of frames) {
    let unescaped;
    try {
      unescaped = unescapePacket(frame);
    } catch {
      continue;
    }

    if (unescaped.length < 2) {
      shortPkts++;
      continue;
    }

    const data   = unescaped.slice(0, -1);
    const rxChk  = unescaped[unescaped.length - 1];
    const calcChk = computeChecksum(data);

    if (rxChk !== calcChk) {
      badChk++;
      process.stdout.write(`  [WARN] checksum FAIL  rx=0x${rxChk.toString(16).padStart(2,"0")}  calc=0x${calcChk.toString(16).padStart(2,"0")}  len=${data.length}\n`);
      continue;
    }

    goodPkts++;

    if (data.length < 16) {
      shortPkts++;
      continue;
    }

    try {
      const parsed = parsePhdbPacket(data);
      phdbResults.push(parsed);
    } catch (e) {
      console.error("  [ERR] parsePhdbPacket: " + e.message);
    }
  }

  console.log("\n  Good packets  : " + goodPkts);
  console.log("  Bad checksum  : " + badChk);
  console.log("  Too short     : " + shortPkts);

  // ── PHDB summary ───────────────────────────────────────────────────────────
  const phdbWithVitals = phdbResults.filter(r => !r.skipped && r.results?.length > 0);
  const wavePackets    = phdbResults.filter(r => r.skipped);

  console.log("  PHDB packets  : " + phdbResults.filter(r => !r.skipped).length);
  console.log("  Wave packets  : " + wavePackets.length);
  console.log("  PHDB w/ vitals: " + phdbWithVitals.length);

  // Collect all vitals seen
  const vitalCount = {};
  const vitalMin   = {};
  const vitalMax   = {};

  for (const pkt of phdbWithVitals) {
    for (const { vals } of pkt.results) {
      for (const [k, v] of Object.entries(vals)) {
        vitalCount[k] = (vitalCount[k] || 0) + 1;
        const n = parseFloat(v);
        if (Number.isFinite(n)) {
          if (vitalMin[k] === undefined || n < vitalMin[k]) vitalMin[k] = n;
          if (vitalMax[k] === undefined || n > vitalMax[k]) vitalMax[k] = n;
        }
      }
    }
  }

  if (Object.keys(vitalCount).length > 0) {
    console.log("\nVital sign parameters decoded from binary:");
    const sortedV = Object.entries(vitalCount).sort((a, b) => b[1] - a[1]);
    for (const [k, cnt] of sortedV) {
      const range = (vitalMin[k] !== undefined)
        ? `  range: ${vitalMin[k]} – ${vitalMax[k]}`
        : "";
      console.log(`  (${String(cnt).padStart(3)} packets)  ${k.padEnd(12)}${range}`);
    }
  }

  // ── First 5 PHDB packets with vitals ──────────────────────────────────────
  console.log("\nFirst 5 PHDB packets with vitals:");
  for (const pkt of phdbWithVitals.slice(0, 5)) {
    console.log(`  r_nbr=${pkt.rNbr}  r_len=${pkt.rLen}  subrecords=${pkt.results.length}`);
    for (const { kind, sr_offset, vals } of pkt.results) {
      const keys = Object.keys(vals);
      if (keys.length === 0) {
        console.log(`    [${kind}@${sr_offset}] — all invalid/not-updated`);
      } else {
        const line = keys.map(k => `${k}=${vals[k]}`).join("  ");
        console.log(`    [${kind}@${sr_offset}] ${line}`);
      }
    }
  }

  return { goodPkts, badChk, phdbWithVitals };
}

// ─── Cross-check ──────────────────────────────────────────────────────────────

function crossCheck(csvRows, rawStats) {
  console.log("\n" + "=".repeat(70));
  console.log("CROSS-CHECK: CSV vs Raw Binary");
  console.log("=".repeat(70));

  const csvTs  = csvRows.map(r => new Date(r.ts));
  const csvMin = csvTs.length ? new Date(Math.min(...csvTs)).toISOString() : "–";
  const csvMax = csvTs.length ? new Date(Math.max(...csvTs)).toISOString() : "–";

  console.log(`  CSV timespan : ${csvMin}  →  ${csvMax}`);
  console.log(`  CSV rows w/ HR data   : ` +
    csvRows.filter(r => r.params["Heart Rate(/min)"] != null).length);
  console.log(`  CSV rows w/ SpO2 data : ` +
    csvRows.filter(r => r.params["SpO2(%)"] != null).length);
  console.log(`  CSV rows w/ BP data   : ` +
    csvRows.filter(r => r.params["Systolic BP(mmHg)"] != null).length);

  const rawVitals = rawStats.phdbWithVitals;
  console.log(`  Raw PHDB vitals pkts  : ${rawVitals.length}`);

  // Check CSV HR / SpO2 typical values vs raw decoded values
  const csvHRs = csvRows
    .map(r => r.params["Heart Rate(/min)"])
    .filter(v => typeof v === "number");
  const csvSpo2s = csvRows
    .map(r => r.params["SpO2(%)"])
    .filter(v => typeof v === "number");

  if (csvHRs.length) {
    const avg = (csvHRs.reduce((a, b) => a + b, 0) / csvHRs.length).toFixed(1);
    console.log(`\n  CSV HR  : ${Math.min(...csvHRs)} – ${Math.max(...csvHRs)} bpm  (avg ${avg})`);
  }
  if (csvSpo2s.length) {
    const avg = (csvSpo2s.reduce((a, b) => a + b, 0) / csvSpo2s.length).toFixed(1);
    console.log(`  CSV SpO2: ${Math.min(...csvSpo2s)} – ${Math.max(...csvSpo2s)} %  (avg ${avg})`);
  }
}

// ─── Run ──────────────────────────────────────────────────────────────────────

const csvRows  = parseAS3CSV(CSV_PATH);
const rawStats = parseRawFile(RAW_PATH);

if (csvRows && rawStats) {
  crossCheck(csvRows, rawStats);
}

console.log("\nDone.");
