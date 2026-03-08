'use strict';

const dgram  = require('dgram');
const fs     = require('fs');
const path   = require('path');

const { parse }  = require('./parser');
const Recorder   = require('./recorder');
const mapper     = require('./mapper');
const beacon     = require('./beacon');

// ─── ANSI colours ────────────────────────────────────────────────────────────
const C = {
  reset  : '\x1b[0m',
  green  : '\x1b[32m',
  yellow : '\x1b[33m',
  dim    : '\x1b[2m',
  cyan   : '\x1b[36m',
  red    : '\x1b[31m',
  bold   : '\x1b[1m',
};

// ─── CLI args ─────────────────────────────────────────────────────────────────
// Confirmed from pcapng analysis:
//   port 2050 → per-monitor multicast 224.0.1.X:2050  (main waveform+vitals data)
//   port 2000 → shared multicast 224.127.1.254:2000   (numeric snapshot, 268B)
//   port 9250 → shared multicast 224.127.1.252:9250   (secondary data, 268B)
//   port 2100 → shared multicast 224.127.1.253:2100   (heartbeat, 24B)
//   port 2150 → shared multicast 224.127.1.255:2150   (device registration)
//
// Usage:
//   node capture.js --port 2050                         (main data — joins 224.0.1.* groups)
//   node capture.js --port 2000                         (numeric snapshot)
//   node capture.js --port 2050 --monitor 10.39.225.114 (single monitor)
//   node capture.js --port 2050 --iface 10.39.225.50    (bind specific NIC)
//   node capture.js --port 7000                         (beacons only)
//   node capture.js --port 2050 --quiet                 (no per-packet console)

const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : def;
}

const UDP_PORT  = parseInt(getArg('port',    '2050'), 10);
const IFACE     = getArg('iface',   '0.0.0.0');
const SOURCE    = getArg('source',  '10.39.');
const QUIET     = args.includes('--quiet');
const MONITOR   = getArg('monitor', null); // e.g. 10.39.225.114 — join only that monitor's group

// Shared multicast groups (same group used by all monitors on that port)
const SHARED_GROUPS = {
  2000: ['224.127.1.254'],
  9250: ['224.127.1.252'],
  2100: ['224.127.1.253'],
  2150: ['224.127.1.255'],
  7000: [], // broadcast, no multicast group needed
  7001: [], // broadcast
};

// For port 2050, each monitor uses its own group 224.0.1.X (last octet of monitor IP)
// We join all 254 possible groups in the 224.0.1.0/24 range, or just one if --monitor set
function groupsForPort(port, monitorIp) {
  if (SHARED_GROUPS[port] !== undefined) return SHARED_GROUPS[port];
  if (port === 2050) {
    if (monitorIp) {
      const last = monitorIp.split('.').pop();
      return [`224.0.1.${last}`];
    }
    // join all 254 per-monitor groups
    return Array.from({ length: 254 }, (_, i) => `224.0.1.${i + 1}`);
  }
  return [];
}

// Legacy --group override
const GROUP = getArg('group', null);

// ─── Session ──────────────────────────────────────────────────────────────────
const sessionName = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
const SESSION_DIR = path.join(__dirname, 'sessions', sessionName);
fs.mkdirSync(SESSION_DIR, { recursive: true });

const recorder   = new Recorder(SESSION_DIR);
let   keyMap     = mapper.load();
let   reloadCnt  = 0;
let   totalPkts  = 0;
let   filteredPkts = 0;

// ─── Socket ───────────────────────────────────────────────────────────────────
const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

socket.on('listening', () => {
  try { socket.setBroadcast(true); } catch (_) {}

  const iface = IFACE === '0.0.0.0' ? undefined : IFACE;

  // Determine multicast groups to join
  const groups = GROUP ? [GROUP] : groupsForPort(UDP_PORT, MONITOR);
  let joined = 0;
  for (const g of groups) {
    try {
      socket.addMembership(g, iface);
      joined++;
    } catch (_) { /* group unavailable on this interface — skip */ }
  }

  const addr = socket.address();
  console.log(`${C.bold}drgmonudp capture${C.reset}`);
  console.log(`  Port      : ${C.cyan}${addr.port}${C.reset}`);
  console.log(`  Multicast : ${joined} group(s) joined${MONITOR ? ` (monitor ${MONITOR})` : ''}`);
  if (groups.length <= 4) console.log(`  Groups    : ${groups.join(', ')}`);
  console.log(`  Bind iface: ${IFACE}`);
  console.log(`  Source flt: ${C.cyan}${SOURCE || 'none (all)'}${C.reset}`);
  console.log(`  Session   : ${SESSION_DIR}`);
  console.log(`  map.json  : ${Object.keys(keyMap).length} entries`);
  console.log(`\n${C.dim}Press Ctrl+C to stop${C.reset}`);
  console.log('─'.repeat(72));
});

// Track known monitors from beacons (ip -> roomBed string)
const monitors = new Map();

socket.on('message', (msg, rinfo) => {
  totalPkts++;

  // ── source IP filter ──────────────────────────────────────────────────────
  if (SOURCE && !rinfo.address.startsWith(SOURCE)) return;
  filteredPkts++;

  const buf = Buffer.from(msg);

  // ── beacon packet (88 bytes, port 7000 announcements) ────────────────────
  if (beacon.isBeacon(buf)) {
    const info = beacon.decode(buf);
    const isNew = !monitors.has(info.ip);
    monitors.set(info.ip, info.roomBed);
    if (!QUIET && isNew) {
      console.log(
        `\n${C.dim}[beacon]${C.reset}  ` +
        `${C.cyan}${info.ip}${C.reset}  ` +
        `bed=${C.bold}${info.roomBed}${C.reset}  ` +
        `counter=${info.counter}`
      );
    }
    return;
  }

  const parsed = parse(buf);
  const { ts, idx } = recorder.record(buf, parsed);

  // hot-reload map every 20 packets
  if (++reloadCnt % 20 === 0) keyMap = mapper.load();

  if (QUIET) return;

  // ── header ────────────────────────────────────────────────────────────────
  console.log(
    `\n${C.dim}[${ts}]${C.reset} #${idx}  ` +
    `src=${C.cyan}${rinfo.address}:${rinfo.port}${C.reset}  ` +
    `size=${C.bold}${buf.length}${C.reset}`
  );

  // Only show bed if it contains printable ASCII (offset-65 extraction is unreliable on port 2050)
  if (parsed.bed && /^[\x20-\x7e]+$/.test(parsed.bed)) console.log(`  ${C.bold}BED  ${C.reset} : ${parsed.bed}`);
  if (parsed.msg) console.log(`  ${C.red}ALERT${C.reset} : ${parsed.msg}`);

  // ── numeric params ────────────────────────────────────────────────────────
  const skip = new Set(['_ip', '_size', 'wave_key', 'bed', 'msg']);
  const numericKeys = Object.keys(parsed)
    .filter(k => !skip.has(k) && !Array.isArray(parsed[k]))
    .sort();

  for (const k of numericKeys) {
    const val   = parsed[k];
    const entry = keyMap[k];
    if (entry) {
      const colour = entry.confirmed ? C.green : C.yellow;
      const mark   = entry.confirmed ? ' ' : '?';
      console.log(
        `  ${colour}${mark} ${entry.name.padEnd(14)}${C.reset}` +
        ` ${String(val).padStart(8)}  ${C.dim}${(entry.unit || '').padEnd(6)}${C.reset}` +
        `  ${C.dim}[${k}]${C.reset}`
      );
    } else {
      console.log(
        `  ${C.dim}?  ${'?'.padEnd(14)}${C.reset}` +
        ` ${String(val).padStart(8)}` +
        `  ${C.dim}[${k}]${C.reset}`
      );
    }
  }

  // ── wave channels ─────────────────────────────────────────────────────────
  const waves = parsed.wave_key || {};
  if (Object.keys(waves).length > 0) {
    const labels = Object.entries(waves)
      .map(([k, n]) => {
        const e = keyMap[k];
        return `${e ? e.name : k}(${n}smpl)`;
      })
      .join('  ');
    console.log(`  ${C.cyan}~ waves${C.reset}: ${labels}`);
  }
});

socket.on('error', (err) => {
  console.error(`${C.red}Socket error: ${err.message}${C.reset}`);
  recorder.close();
  socket.close();
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log(`\nTotal UDP received: ${totalPkts}  matched source filter: ${filteredPkts}`);
  recorder.close();
  socket.close();
  process.exit(0);
});

socket.bind(UDP_PORT, IFACE);
