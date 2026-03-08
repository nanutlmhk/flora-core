'use strict';

// CLI tool to add / update / confirm / remove key mappings in map.json
//
// Usage:
//   node annotate.js --key "0-100-0-1-2" --name HR --unit bpm
//   node annotate.js --key "0-100-0-1-2" --name HR --unit bpm --confirm
//   node annotate.js --confirm "0-100-0-1-2"
//   node annotate.js --remove  "0-100-0-1-2"
//   node annotate.js --list

const mapper = require('./mapper');

const args = process.argv.slice(2);

function getArg(name) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : null;
}

function hasFlag(name) {
  return args.includes(`--${name}`);
}

// ── list ──────────────────────────────────────────────────────────────────────
if (hasFlag('list')) {
  const map = mapper.load();
  const keys = Object.keys(map).sort();
  if (keys.length === 0) {
    console.log('map.json is empty — no mappings yet.');
    process.exit(0);
  }
  console.log(`${'KEY'.padEnd(30)} ${'NAME'.padEnd(16)} ${'UNIT'.padEnd(8)} CONFIRMED`);
  console.log('─'.repeat(70));
  for (const k of keys) {
    const e = map[k];
    console.log(
      `${k.padEnd(30)} ${(e.name || '').padEnd(16)} ${(e.unit || '').padEnd(8)} ${e.confirmed ? 'yes' : 'no'}`
    );
  }
  process.exit(0);
}

// ── confirm ───────────────────────────────────────────────────────────────────
const confirmKey = getArg('confirm');
if (confirmKey) {
  mapper.confirm(confirmKey);
  console.log(`Confirmed: ${confirmKey}`);
  process.exit(0);
}

// ── remove ────────────────────────────────────────────────────────────────────
const removeKey = getArg('remove');
if (removeKey) {
  mapper.remove(removeKey);
  console.log(`Removed: ${removeKey}`);
  process.exit(0);
}

// ── add / update ──────────────────────────────────────────────────────────────
const key  = getArg('key');
const name = getArg('name');

if (!key || !name) {
  console.log([
    'annotate.js — manage parameter key mappings',
    '',
    'Commands:',
    '  --list                                   show all mappings',
    '  --key <key> --name <name> [--unit <u>]  add or update a mapping',
    '  --key <key> --name <name> --confirm      add and mark as confirmed',
    '  --confirm <key>                          mark existing mapping confirmed',
    '  --remove  <key>                          delete a mapping',
    '',
    'Example:',
    '  node annotate.js --key "0-100-0-1-2" --name HR --unit bpm --confirm',
  ].join('\n'));
  process.exit(0);
}

const unit      = getArg('unit') || '';
const confirmed = hasFlag('confirm');

const entry = mapper.set(key, name, unit, confirmed);
console.log(`Saved: [${key}] -> ${entry.name} (${entry.unit}) confirmed=${entry.confirmed}`);
