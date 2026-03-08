'use strict';

// Listens on many UDP ports simultaneously to find Draeger IACS traffic.
//
// Phase 1 (default): scan for vital-signs data packets — skips port 7000
//   which is already known to carry 88-byte beacon/announcement packets.
//   Looks for packets whose size matches known IACS data sizes (302/602/1298).
//
// Usage:
//   node discover.js                         (data packet hunt, skip port 7000)
//   node discover.js --all-ports             (include port 7000 beacons too)
//   node discover.js --source 10.39.226.     (default source filter)
//   node discover.js --timeout 60            (seconds, default 60)

const dgram  = require('dgram');
const os     = require('os');
const beacon = require('./beacon');

const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : def;
}

const SOURCE   = getArg('source',  '10.39.');   // covers 10.39.225.x and 10.39.226.x
const TIMEOUT  = parseInt(getArg('timeout', '60'), 10) * 1000;
const ALL_PORTS = args.includes('--all-ports');

// Known IACS vital-signs packet sizes from Ruby parser
const KNOWN_DATA_SIZES = new Set([110, 252, 302, 398, 602, 1298]);

// Port 7000 = beacon/announcement (88 bytes), already known
const SKIP_PORTS = ALL_PORTS ? [] : [7000];

// Confirmed ports from pcapng (these are prioritised)
const KNOWN_PORTS = [2000, 2050, 2100, 2150, 9250, 7000, 7001];

// Known multicast groups per port (from pcapng analysis)
const KNOWN_GROUPS = {
  2000: ['224.127.1.254'],
  9250: ['224.127.1.252'],
  2100: ['224.127.1.253'],
  2150: ['224.127.1.255'],
  // 2050: per-monitor 224.0.1.X — we join a sample range
};
// For port 2050, join 224.0.1.100–224.0.1.130 as a sample (pcapng showed .101–.126)
KNOWN_GROUPS[2050] = Array.from({ length: 30 }, (_, i) => `224.0.1.${101 + i}`);

// Additional sweep ports
const PROBE_PORTS = [
  ...KNOWN_PORTS,
  1234, 1500, 2500, 3000, 4000, 4545, 5000, 5555, 5900,
  6000, 6500, 7002, 8000, 8080, 8888, 9000, 9100, 9200, 10000,
].filter((p, i, a) => a.indexOf(p) === i && !SKIP_PORTS.includes(p));

// ─── Local NIC info ───────────────────────────────────────────────────────────
console.log('Local network interfaces:');
const ifaces = os.networkInterfaces();
for (const [name, addrs] of Object.entries(ifaces)) {
  for (const a of addrs) {
    if (a.family === 'IPv4' && !a.internal) {
      console.log(`  ${name.padEnd(20)} ${a.address}`);
    }
  }
}

console.log();
console.log('Known: port 7000 = 88-byte beacon (monitor announcement)');
console.log(`Hunting: vital-signs data packets (expect sizes: ${[...KNOWN_DATA_SIZES].join('/')} bytes)`);
console.log(`Probing ${PROBE_PORTS.length} ports  source filter: ${SOURCE || 'any'}`);
console.log(`Timeout: ${TIMEOUT / 1000}s  —  Ctrl+C to stop early`);
console.log('─'.repeat(70));

// ─── Track results ────────────────────────────────────────────────────────────
// key = "srcIP:dstPort"
const seen    = new Map();
// known monitors from beacons (populated if --all-ports or from previous knowledge)
const monitors = new Map(); // ip -> roomBed

const sockets = [];

function classify(buf) {
  if (beacon.isBeaconA(buf)) return 'beacon-A';  // port 7000, 88 bytes
  if (beacon.isBeaconB(buf)) return 'beacon-B';  // port 7001, 84 bytes
  if (KNOWN_DATA_SIZES.has(buf.length)) return 'iacs-data';
  return 'unknown';
}

function hexPreview(buf, n = 40) {
  const bytes = Array.from(buf.slice(0, n))
    .map(b => b.toString(16).padStart(2, '0'))
    .join(' ');
  return buf.length > n ? bytes + ' ...' : bytes;
}

// ─── Open one socket per port ─────────────────────────────────────────────────
for (const port of PROBE_PORTS) {
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  sock.on('error', () => { /* port in use — skip */ });

  sock.on('message', (msg, rinfo) => {
    if (SOURCE && !rinfo.address.startsWith(SOURCE)) return;

    const buf  = Buffer.from(msg);
    const type = classify(buf);
    const key  = `${rinfo.address}:${port}`;

    // decode beacons
    if (type === 'beacon-A' || type === 'beacon-B') {
      const info = beacon.decode(buf);
      if (info) monitors.set(info.ip, info.roomBed);
    }

    if (!seen.has(key)) {
      seen.set(key, {
        src      : rinfo.address,
        srcPort  : rinfo.port,
        dstPort  : port,
        size     : buf.length,
        type,
        count    : 1,
        firstSeen: new Date().toISOString(),
        preview  : hexPreview(buf),
      });

      const e    = seen.get(key);
      const mark = type === 'iacs-data' ? '*** IACS DATA' : type.startsWith('beacon') ? type : '?';
      const bed  = monitors.get(e.src) ? `  bed=${monitors.get(e.src)}` : '';

      console.log(`\n  [${mark}]  src=${e.src}:${e.srcPort}  dst-port=${e.dstPort}  size=${e.size}${bed}`);
      console.log(`           first=${e.firstSeen}`);
      console.log(`           hex  =${e.preview}`);

      if (type === 'iacs-data') {
        console.log(`\n  --> node capture.js --port ${e.dstPort}`);
      }
    } else {
      seen.get(key).count++;
    }
  });

  sock.on('listening', () => {
    try { sock.setBroadcast(true); } catch (_) {}
    // Join any known multicast groups for this port
    const groups = KNOWN_GROUPS[port] || [];
    let joined = 0;
    for (const g of groups) {
      try { sock.addMembership(g); joined++; } catch (_) {}
    }
    if (joined > 0) {
      console.log(`  port ${port}: joined ${joined}/${groups.length} multicast group(s)`);
    }
  });

  try {
    sock.bind(port);
    sockets.push(sock);
  } catch (_) { /* skip */ }
}

// ─── Status ticker ────────────────────────────────────────────────────────────
const statusInterval = setInterval(() => {
  const dataFound = [...seen.values()].filter(e => e.type === 'iacs-data').length;
  if (dataFound > 0) {
    process.stdout.write(`\r  IACS data found on ${dataFound} port(s). Still listening...          `);
  } else {
    process.stdout.write(`\r  Waiting... ports open=${sockets.length}  packets seen=${seen.size}          `);
  }
}, 2000);

// ─── Shutdown ─────────────────────────────────────────────────────────────────
function shutdown() {
  clearInterval(statusInterval);
  for (const s of sockets) { try { s.close(); } catch (_) {} }

  console.log('\n\n' + '─'.repeat(70));
  console.log('SUMMARY');
  console.log('─'.repeat(70));

  // Known monitors from beacons
  if (monitors.size > 0) {
    console.log('\nMonitors (from beacons):');
    for (const [ip, bed] of monitors) {
      console.log(`  ${ip.padEnd(18)} ${bed}`);
    }
  }

  const dataEntries  = [...seen.values()].filter(e => e.type === 'iacs-data');
  const otherEntries = [...seen.values()].filter(e => e.type !== 'iacs-data' && !e.type.startsWith('beacon'));

  if (dataEntries.length > 0) {
    console.log('\nIACS data packets found:');
    for (const e of dataEntries) {
      const bed = monitors.get(e.src) ? ` (${monitors.get(e.src)})` : '';
      console.log(`  ${e.src}${bed}  port=${e.dstPort}  size=${e.size}  count=${e.count}`);
    }
    const ports = [...new Set(dataEntries.map(e => e.dstPort))];
    console.log(`\nNext step:\n  node capture.js --port ${ports[0]}`);
  } else {
    console.log('\nNo IACS data packets found.');
    console.log('The monitor may require a subscription request before streaming data.');
    console.log('Known monitors to try subscribing to:');
    for (const [ip] of monitors) {
      console.log(`  ${ip}`);
    }
    console.log('\nTry running capture.js on port 7000 to at least confirm beacons:');
    console.log('  node capture.js --port 7000');
  }

  if (otherEntries.length > 0) {
    console.log('\nOther unknown UDP traffic:');
    for (const e of otherEntries) {
      console.log(`  ${e.src}  port=${e.dstPort}  size=${e.size}  count=${e.count}`);
      console.log(`  hex: ${e.preview}`);
    }
  }

  process.exit(0);
}

setTimeout(shutdown, TIMEOUT);
process.on('SIGINT', shutdown);
