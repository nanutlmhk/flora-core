'use strict';

// Reads a pcapng file and extracts all UDP packets from 10.39.x.x network.
// Shows port distribution, packet sizes, hex previews, and runs IACS parser
// on any packets that match known sizes.
//
// Usage:
//   node readpcap.js --file "C:\Users\onlys\Downloads\ccccc.pcapng"
//   node readpcap.js --file capture.pcapng --source 10.39.
//   node readpcap.js --file capture.pcapng --port 7000      (filter one port)
//   node readpcap.js --file capture.pcapng --replay         (run IACS parser on matches)

const fs     = require('fs');
const path   = require('path');
const { parse } = require('./parser');
const beacon    = require('./beacon');

const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : def;
}

const FILE        = getArg('file',   null);
const SOURCE      = getArg('source', '10.39.');
const PORT_FILTER = getArg('port',   null) ? parseInt(getArg('port', null), 10) : null;
const REPLAY      = args.includes('--replay');
const VERBOSE     = args.includes('--verbose');

if (!FILE) {
  console.log([
    'readpcap.js — analyze a Wireshark pcapng capture',
    '',
    'Usage:',
    '  node readpcap.js --file "C:\\Users\\onlys\\Downloads\\ccccc.pcapng"',
    '  node readpcap.js --file capture.pcapng --source 10.39.',
    '  node readpcap.js --file capture.pcapng --port 7000',
    '  node readpcap.js --file capture.pcapng --replay',
  ].join('\n'));
  process.exit(0);
}

if (!fs.existsSync(FILE)) {
  console.error('File not found:', FILE);
  process.exit(1);
}

const raw = fs.readFileSync(FILE);
console.log(`File    : ${FILE}`);
console.log(`Size    : ${raw.length} bytes`);

// ─── PCAPNG parser ────────────────────────────────────────────────────────────
let pos          = 0;
let littleEndian = true;
const interfaces = []; // linkType per interface index

function u16(offset) { return littleEndian ? raw.readUInt16LE(offset) : raw.readUInt16BE(offset); }
function u32(offset) { return littleEndian ? raw.readUInt32LE(offset) : raw.readUInt32BE(offset); }

// block type constants
const SHB = 0x0A0D0D0A;
const IDB = 0x00000001;
const EPB = 0x00000006;
const SPB = 0x00000003;
const OPB = 0x00000002;

const udpPackets = [];

while (pos + 8 <= raw.length) {
  // peek at block type (always LE for SHB detection)
  const rawType = raw.readUInt32LE(pos);

  if (rawType === SHB) {
    const blockLen = raw.readUInt32LE(pos + 4);
    const magic    = raw.readUInt32LE(pos + 8);
    littleEndian   = (magic === 0x1A2B3C4D);
    if (blockLen < 28 || pos + blockLen > raw.length) break;
    pos += blockLen;
    continue;
  }

  const type = u32(pos);
  const len  = u32(pos + 4);
  if (len < 12 || pos + len > raw.length) break;

  if (type === IDB) {
    interfaces.push({ linkType: u16(pos + 8) });
    pos += len;
    continue;
  }

  if (type === EPB) {
    const ifId    = u32(pos + 8);
    const captLen = u32(pos + 20);
    const pktData = raw.slice(pos + 28, pos + 28 + captLen);
    const ltype   = (interfaces[ifId] || { linkType: 1 }).linkType;
    const udp     = extractUdp(pktData, ltype);
    if (udp) udpPackets.push(udp);
    pos += len;
    continue;
  }

  if (type === SPB) {
    const captLen = u32(pos + 8);
    const pktData = raw.slice(pos + 16, pos + 16 + captLen);
    const ltype   = (interfaces[0] || { linkType: 1 }).linkType;
    const udp     = extractUdp(pktData, ltype);
    if (udp) udpPackets.push(udp);
    pos += len;
    continue;
  }

  pos += len; // skip unknown blocks
}

// ─── UDP extraction from raw frame ───────────────────────────────────────────
function extractUdp(pkt, linkType) {
  let off = 0;

  if (linkType === 1) {          // Ethernet
    if (pkt.length < 14) return null;
    let et = pkt.readUInt16BE(12);
    off = 14;
    if (et === 0x8100) { et = pkt.readUInt16BE(16); off = 18; } // VLAN tag
    if (et !== 0x0800) return null; // not IPv4
  } else if (linkType === 113) { // Linux cooked
    if (pkt.length < 16) return null;
    const et = pkt.readUInt16BE(14);
    if (et !== 0x0800) return null;
    off = 16;
  } else if (linkType === 228) { // Raw IPv4
    off = 0;
  } else {
    return null;
  }

  if (pkt.length < off + 20) return null;
  const ihl      = (pkt[off] & 0x0f) * 4;
  const protocol = pkt[off + 9];
  if (protocol !== 17) return null; // not UDP

  const srcIp = `${pkt[off+12]}.${pkt[off+13]}.${pkt[off+14]}.${pkt[off+15]}`;
  const dstIp = `${pkt[off+16]}.${pkt[off+17]}.${pkt[off+18]}.${pkt[off+19]}`;

  off += ihl;
  if (pkt.length < off + 8) return null;

  const srcPort = pkt.readUInt16BE(off);
  const dstPort = pkt.readUInt16BE(off + 2);
  const udpLen  = pkt.readUInt16BE(off + 4);
  const payload = pkt.slice(off + 8, off + udpLen); // udpLen includes 8-byte header

  return { srcIp, dstIp, srcPort, dstPort, payload };
}

// ─── Filter ───────────────────────────────────────────────────────────────────
// Confirmed data ports from pcapng analysis:
//   port 2050 → per-monitor multicast 224.0.1.X  (waveform+vitals, variable size)
//   port 2000 → shared multicast 224.127.1.254   (numeric snapshot, 268 bytes)
//   port 9250 → shared multicast 224.127.1.252   (secondary, 268 bytes)
const IACS_SIZES = new Set([
  88, 84,                                                   // beacons
  268,                                                      // port 2000/9250
  616, 628, 670, 732, 746, 778, 794, 820, 852, 924, 936,   // port 2050 waveforms
  938, 950, 960, 962, 976, 1052, 1062, 1094, 1118, 1154,
  1218, 1288, 1310, 1324, 1362, 1404, 1406, 1414, 1416,
  1418, 1422, 1434, 1436,
]);

const filtered = udpPackets.filter(p => {
  const matchSrc = !SOURCE || p.srcIp.startsWith(SOURCE) || p.dstIp.startsWith(SOURCE);
  const matchPort = !PORT_FILTER || p.srcPort === PORT_FILTER || p.dstPort === PORT_FILTER;
  return matchSrc && matchPort;
});

console.log(`UDP pkts: ${udpPackets.length} total  ${filtered.length} matching ${SOURCE || 'any'}\n`);

if (filtered.length === 0) {
  console.log('No matching UDP packets found.');
  console.log('Try --source "" to see all UDP traffic.');
  process.exit(0);
}

// ─── Port distribution ────────────────────────────────────────────────────────
const byPort = {}; // dstPort -> { count, sizes: Map<size, firstPkt> }
const bySrc  = {}; // srcIp  -> count

for (const p of filtered) {
  const key = p.dstPort;
  if (!byPort[key]) byPort[key] = { count: 0, sizes: new Map() };
  byPort[key].count++;
  if (!byPort[key].sizes.has(p.payload.length)) {
    byPort[key].sizes.set(p.payload.length, p);
  }
  bySrc[p.srcIp] = (bySrc[p.srcIp] || 0) + 1;
}

// ─── Source IPs ───────────────────────────────────────────────────────────────
console.log('SOURCE IPs:');
for (const [ip, cnt] of Object.entries(bySrc).sort((a, b) => b[1] - a[1])) {
  // try to identify from beacon
  const beaconPkt = filtered.find(p => p.srcIp === ip && beacon.isBeacon(p.payload));
  const bedLabel  = beaconPkt ? '  ' + beacon.decode(beaconPkt.payload)?.roomBed : '';
  console.log(`  ${ip.padEnd(18)} ${String(cnt).padStart(5)} pkts${bedLabel}`);
}

// ─── Port table ───────────────────────────────────────────────────────────────
console.log('\nDST PORTS:');
console.log(`  ${'PORT'.padEnd(8)} ${'COUNT'.padStart(6)}  SIZES SEEN`);
console.log('  ' + '─'.repeat(55));

for (const [port, info] of Object.entries(byPort).sort((a, b) => b[1].count - a[1].count)) {
  const sizeList = [...info.sizes.keys()].sort((a, b) => a - b).join(', ');
  const mark     = [...info.sizes.keys()].some(s => IACS_SIZES.has(s)) ? ' <--' : '';
  console.log(`  ${String(port).padEnd(8)} ${String(info.count).padStart(6)}  [${sizeList}]${mark}`);
}

// ─── Per-port hex preview + IACS parse ───────────────────────────────────────
console.log('\nDETAIL PER PORT:');
console.log('─'.repeat(72));

for (const [port, info] of Object.entries(byPort).sort((a, b) => Number(a[0]) - Number(b[0]))) {
  console.log(`\nPort ${port}  (${info.count} packets)`);

  for (const [size, pkt] of info.sizes) {
    const hex = Array.from(pkt.payload.slice(0, 48))
      .map(b => b.toString(16).padStart(2, '0')).join(' ');
    console.log(`  size=${size}  src=${pkt.srcIp}:${pkt.srcPort} -> ${pkt.dstIp}:${pkt.dstPort}`);
    console.log(`  hex: ${hex}${pkt.payload.length > 48 ? ' ...' : ''}`);

    // try beacon decode
    if (beacon.isBeacon(pkt.payload)) {
      const info2 = beacon.decode(pkt.payload);
      console.log(`  --> BEACON  ip=${info2.ip}  bed=${info2.roomBed}  type=${info2.type}`);
    }

    // try IACS parse if matching known size or --replay
    if (REPLAY || IACS_SIZES.has(size)) {
      try {
        const parsed = parse(pkt.payload);
        const keys   = Object.keys(parsed).filter(k => !['_ip','_size','wave_key','bed','msg'].includes(k));
        if (keys.length > 0 || parsed.bed || parsed.msg) {
          console.log(`  --> IACS parse: bed=${parsed.bed || '-'}  msg=${parsed.msg || '-'}  params=${keys.length}`);
          if (VERBOSE) {
            for (const k of keys) console.log(`       [${k}] = ${parsed[k]}`);
          }
        }
      } catch (_) {}
    }
  }
}

console.log('\n' + '─'.repeat(72));
console.log('NEXT STEP: node capture.js --port <PORT>  for any port marked <--');
