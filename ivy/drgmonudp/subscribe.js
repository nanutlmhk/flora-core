'use strict';

// Probes a Draeger IACS monitor by sending candidate subscription/request
// packets and listening for any response that looks like vital-signs data.
//
// Strategy: from the TYPE B beacon we know the monitor's embedded addressing
// format. We construct plausible "join" packets and try them one by one,
// listening for a response with sizes matching known IACS data packets
// (302, 602, 1298 bytes).
//
// Usage:
//   node subscribe.js --target 10.39.226.151
//   node subscribe.js --target 10.39.226.151 --listen-port 9000
//   node subscribe.js --target 10.39.226.151 --src-port 2007   (monitor's own srcPort from TYPE B)

const dgram = require('dgram');
const os    = require('os');

const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : def;
}

const TARGET      = getArg('target', null);
const LISTEN_PORT = parseInt(getArg('listen-port', '7002'), 10);
const SRC_PORT    = parseInt(getArg('src-port',    '2007'), 10); // from TYPE B beacon srcPort
const TIMEOUT_MS  = parseInt(getArg('timeout',     '5'),   10) * 1000;

if (!TARGET) {
  console.log([
    'subscribe.js — probe a monitor for subscription protocol',
    '',
    'Usage:',
    '  node subscribe.js --target 10.39.226.151',
    '  node subscribe.js --target 10.39.226.151 --listen-port 9000',
    '  node subscribe.js --target 10.39.226.151 --src-port 2007',
    '',
    'Known monitors:',
    '  10.39.226.191  OR|C2',
    '  10.39.226.184  OR|903',
    '  10.39.226.154  OR|805',
    '  10.39.226.151  OR|802',
  ].join('\n'));
  process.exit(0);
}

// Parse target IP into bytes
const targetBytes = TARGET.split('.').map(Number);
if (targetBytes.length !== 4) {
  console.error('Invalid --target IP');
  process.exit(1);
}

// Get our own IP on the 10.39.226.x interface
function getLocalIp() {
  const ifaces = os.networkInterfaces();
  for (const addrs of Object.values(ifaces)) {
    for (const a of addrs) {
      if (a.family === 'IPv4' && !a.internal && a.address.startsWith('10.39.')) {
        return a.address;
      }
    }
  }
  return null;
}
const localIp = getLocalIp();
if (!localIp) {
  console.warn('Warning: no 10.39.226.x interface found — subscription packets may not reach monitor');
}
const localBytes = (localIp || '0.0.0.0').split('.').map(Number);

console.log(`Target       : ${TARGET}`);
console.log(`Local IP     : ${localIp || '(unknown)'}`);
console.log(`Listen port  : ${LISTEN_PORT}`);
console.log(`Monitor port : ${SRC_PORT} (from TYPE B beacon)`);
console.log('─'.repeat(60));

// ─── Candidate subscription packets ──────────────────────────────────────────
// Constructed by mirroring the TYPE B beacon structure — a "join" packet
// would logically reverse the src/dst fields to say "send data to me".
//
// TYPE B beacon structure (monitor -> broadcast):
//   [0-3]  dest IP (broadcast)  [4-5]  dest port (7001)
//   [6-9]  src IP (monitor)     [10-11] src port
//   [12-23] flags
//   [24+]  room|bed string
//
// Candidate "join" reversal (client -> monitor):
//   [0-3]  dest IP (monitor)    [4-5]  dest port (SRC_PORT)
//   [6-9]  src IP (client)      [10-11] src port (LISTEN_PORT)
//   [12-23] flags (same as beacon)
//   [24+]  zeros (no room|bed needed from client side)

function buildJoinPacket(size = 84) {
  const buf = Buffer.alloc(size, 0);
  // dest = monitor
  buf[0] = targetBytes[0]; buf[1] = targetBytes[1];
  buf[2] = targetBytes[2]; buf[3] = targetBytes[3];
  buf[4] = (SRC_PORT >> 8) & 0xff;
  buf[5] =  SRC_PORT       & 0xff;
  // src = us
  buf[6] = localBytes[0]; buf[7] = localBytes[1];
  buf[8] = localBytes[2]; buf[9] = localBytes[3];
  buf[10] = (LISTEN_PORT >> 8) & 0xff;
  buf[11] =  LISTEN_PORT       & 0xff;
  // flags mirrored from observed TYPE B
  buf[12] = 0x00; buf[13] = 0xc9; // 201
  buf[14] = 0x00; buf[15] = 0x04; // 4
  buf[16] = 0x00; buf[17] = 0x01; // 1
  buf[18] = 0x00; buf[19] = 0x00;
  buf[20] = 0x00; buf[21] = 0x01; // 1
  buf[22] = 0x00; buf[23] = 0x00;
  return buf;
}

// Also try a minimal packet (just the reversed address block)
function buildMinimalJoin() {
  const buf = Buffer.alloc(12, 0);
  buf[0] = targetBytes[0]; buf[1] = targetBytes[1];
  buf[2] = targetBytes[2]; buf[3] = targetBytes[3];
  buf[4] = (SRC_PORT >> 8) & 0xff;
  buf[5] =  SRC_PORT       & 0xff;
  buf[6] = localBytes[0]; buf[7] = localBytes[1];
  buf[8] = localBytes[2]; buf[9] = localBytes[3];
  buf[10] = (LISTEN_PORT >> 8) & 0xff;
  buf[11] =  LISTEN_PORT       & 0xff;
  return buf;
}

const CANDIDATES = [
  { name: 'join-84  (mirrored TYPE B, full)',    port: SRC_PORT, buf: buildJoinPacket(84) },
  { name: 'join-88  (mirrored TYPE B, size A)',  port: SRC_PORT, buf: buildJoinPacket(88) },
  { name: 'join-12  (minimal address block)',    port: SRC_PORT, buf: buildMinimalJoin()  },
  { name: 'join-84  -> port 7000',               port: 7000,     buf: buildJoinPacket(84) },
  { name: 'join-84  -> port 7001',               port: 7001,     buf: buildJoinPacket(84) },
];

// Known IACS vital-signs sizes
const DATA_SIZES = new Set([110, 252, 302, 398, 602, 1298]);

function hexPreview(buf, n = 40) {
  const bytes = Array.from(buf.slice(0, n)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  return buf.length > n ? bytes + ' ...' : bytes;
}

// ─── Socket ───────────────────────────────────────────────────────────────────
const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
let   step = 0;

sock.on('listening', () => {
  try { sock.setBroadcast(true); } catch (_) {}
  console.log(`Listening on :${LISTEN_PORT} for responses\n`);
  sendNext();
});

sock.on('message', (msg, rinfo) => {
  const buf  = Buffer.from(msg);
  const mark = DATA_SIZES.has(buf.length) ? '*** IACS DATA ***' : 'response';
  console.log(`\n  [${mark}]  from=${rinfo.address}:${rinfo.port}  size=${buf.length}`);
  console.log(`  hex: ${hexPreview(buf)}`);
  if (DATA_SIZES.has(buf.length)) {
    console.log('\n  *** Vital signs data received! Run: node capture.js --port ' + LISTEN_PORT);
  }
});

sock.on('error', err => {
  console.error('Socket error:', err.message);
});

function sendNext() {
  if (step >= CANDIDATES.length) {
    console.log('\nAll candidates sent. Waiting for responses...');
    setTimeout(shutdown, TIMEOUT_MS);
    return;
  }

  const c = CANDIDATES[step++];
  console.log(`Sending [${c.name}] -> ${TARGET}:${c.port}  (${c.buf.length} bytes)`);
  console.log(`  hex: ${hexPreview(c.buf)}`);

  sock.send(c.buf, 0, c.buf.length, c.port, TARGET, (err) => {
    if (err) console.error('  send error:', err.message);
    setTimeout(sendNext, TIMEOUT_MS);
  });
}

function shutdown() {
  console.log('\nDone probing. No IACS data received from this monitor.');
  console.log('Next steps:');
  console.log('  1. Run Wireshark on this machine and filter: udp and ip.addr == ' + TARGET);
  console.log('     Then open the real IACS client software to capture the subscription handshake.');
  console.log('  2. Or check if data is on a completely different port via: node discover.js');
  sock.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
sock.bind(LISTEN_PORT);
