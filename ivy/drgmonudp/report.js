'use strict';

// Reads a session's parsed.jsonl and prints:
//   - All unique numeric keys seen, value range, how often they appeared
//   - Wave channels seen
//   - Beds / alerts observed
//
// Usage:
//   node report.js                          (latest session)
//   node report.js --session sessions/2026-03-05T10-30-00

const fs     = require('fs');
const path   = require('path');
const mapper = require('./mapper');

// ── find session ──────────────────────────────────────────────────────────────
const args       = process.argv.slice(2);
const sessionArg = (() => {
  const i = args.indexOf('--session');
  return i !== -1 ? args[i + 1] : null;
})();

function latestSession() {
  const sessDir = path.join(__dirname, 'sessions');
  if (!fs.existsSync(sessDir)) return null;
  const dirs = fs.readdirSync(sessDir)
    .map(d => ({ d, t: fs.statSync(path.join(sessDir, d)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return dirs.length > 0 ? path.join(sessDir, dirs[0].d) : null;
}

const sessionDir = sessionArg
  ? path.resolve(sessionArg)
  : latestSession();

if (!sessionDir || !fs.existsSync(sessionDir)) {
  console.error('No session found. Run capture.js first, or specify --session <path>');
  process.exit(1);
}

const jsonlFile = path.join(sessionDir, 'parsed.jsonl');
if (!fs.existsSync(jsonlFile)) {
  console.error(`parsed.jsonl not found in ${sessionDir}`);
  process.exit(1);
}

// ── load map ──────────────────────────────────────────────────────────────────
const keyMap = mapper.load();

// ── aggregate ─────────────────────────────────────────────────────────────────
const stats   = {};  // key -> { count, min, max, last }
const waves   = {};  // waveKey -> count
const beds    = new Set();
const alerts  = new Set();
const sizes   = {};  // packet size -> count

const lines = fs.readFileSync(jsonlFile, 'utf8').trim().split('\n').filter(Boolean);

for (const line of lines) {
  let rec;
  try { rec = JSON.parse(line); } catch { continue; }

  const parsed = rec.parsed || {};

  // packet size histogram
  sizes[rec.size] = (sizes[rec.size] || 0) + 1;

  if (parsed.bed) beds.add(parsed.bed);
  if (parsed.msg) alerts.add(parsed.msg);

  const skip = new Set(['_ip', '_size', 'wave_key', 'bed', 'msg']);

  for (const [k, v] of Object.entries(parsed)) {
    if (skip.has(k)) continue;
    if (typeof v === 'string' && v.startsWith('[wave:')) continue; // compacted wave

    if (typeof v === 'number' || (typeof v === 'string' && !isNaN(Number(v)))) {
      const n = Number(v);
      if (!stats[k]) stats[k] = { count: 0, min: n, max: n, last: n };
      stats[k].count++;
      if (n < stats[k].min) stats[k].min = n;
      if (n > stats[k].max) stats[k].max = n;
      stats[k].last = n;
    }
  }

  // wave_key
  for (const [wk, n] of Object.entries(parsed.wave_key || {})) {
    waves[wk] = (waves[wk] || 0) + 1;
  }
}

// ── report ────────────────────────────────────────────────────────────────────
console.log(`\nSession : ${sessionDir}`);
console.log(`Packets : ${lines.length}`);

// size histogram
const sizeEntries = Object.entries(sizes).sort((a, b) => Number(a[0]) - Number(b[0]));
console.log(`Sizes   : ${sizeEntries.map(([s, c]) => `${s}B×${c}`).join('  ')}`);

if (beds.size > 0) console.log(`Beds    : ${[...beds].join(', ')}`);
if (alerts.size > 0) console.log(`Alerts  : ${[...alerts].join(' | ')}`);

// numeric params table
const sortedKeys = Object.keys(stats).sort();
const mapped   = sortedKeys.filter(k => keyMap[k]);
const unmapped = sortedKeys.filter(k => !keyMap[k]);

console.log(`\n${'─'.repeat(80)}`);
console.log('NUMERIC PARAMETERS');
console.log(`${'─'.repeat(80)}`);
console.log(`${'KEY'.padEnd(28)} ${'NAME'.padEnd(16)} ${'COUNT'.padStart(6)} ${'MIN'.padStart(8)} ${'MAX'.padStart(8)} ${'LAST'.padStart(8)}`);
console.log(`${'─'.repeat(80)}`);

function printRow(k, label) {
  const s = stats[k];
  console.log(
    `${k.padEnd(28)} ${label.padEnd(16)} ${String(s.count).padStart(6)} ${String(s.min).padStart(8)} ${String(s.max).padStart(8)} ${String(s.last).padStart(8)}`
  );
}

for (const k of mapped) {
  const e = keyMap[k];
  printRow(k, `${e.name}${e.confirmed ? '' : '?'}${e.unit ? ' ' + e.unit : ''}`);
}

if (unmapped.length > 0) {
  console.log(`\n--- UNMAPPED (${unmapped.length}) ---`);
  for (const k of unmapped) {
    printRow(k, '?');
  }
}

// wave channels
if (Object.keys(waves).length > 0) {
  console.log(`\n${'─'.repeat(40)}`);
  console.log('WAVE CHANNELS');
  console.log(`${'─'.repeat(40)}`);
  for (const [wk, cnt] of Object.entries(waves).sort()) {
    const entry = keyMap[wk];
    const label = entry ? `${entry.name} (${entry.unit})` : '?';
    console.log(`  ${wk.padEnd(10)}  ${label.padEnd(20)}  appeared ${cnt}x`);
  }
}

console.log('');
