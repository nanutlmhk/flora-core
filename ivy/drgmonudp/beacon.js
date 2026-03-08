'use strict';

// Decodes broadcast/announcement packets from Draeger IACS monitors.
//
// Two types confirmed from live capture:
//
// TYPE A — port 7000, 88 bytes (simple identity beacon)
//   [0-3]   01 04 00 00   fixed header
//   [4-7]   monitor IP    big-endian
//   [8-9]   69 aa         constant
//   [10-11]               16-bit counter
//   [12+]   "OR|802\0"    null-terminated room|bed string
//   [rest]  00 padding
//
// TYPE B — port 7001, 84 bytes (registration broadcast)
//   [0-3]   dest IP       10.39.226.255 (subnet broadcast)
//   [4-5]   dest port     7001
//   [6-9]   src IP        monitor IP
//   [10-11] src port      (monitor ephemeral port, e.g. 2007)
//   [12-13] 00 c9         = 201
//   [14-15] 00 04         = 4
//   [16-17] 00 01         = 1
//   [18-19] 00 00
//   [20-21] 00 01         = 1
//   [22-23] 00 00
//   [24+]   "OR|802\0"    null-terminated room|bed string
//   [rest]  00 padding

const TYPE_A_SIZE   = 88;
const TYPE_B_SIZE   = 84;
const TYPE_A_HEADER = [0x01, 0x04, 0x00, 0x00];
const TYPE_B_BCAST  = 0xff; // last octet of dest IP is 255 (broadcast)

function isBeaconA(buf) {
  if (buf.length !== TYPE_A_SIZE) return false;
  return TYPE_A_HEADER.every((b, i) => buf[i] === b);
}

function isBeaconB(buf) {
  if (buf.length !== TYPE_B_SIZE) return false;
  // dest IP ends in .255 and dest port = 7001 (0x1b59)
  return buf[3] === TYPE_B_BCAST &&
         buf[4] === 0x1b && buf[5] === 0x59;
}

function isBeacon(buf) {
  return isBeaconA(buf) || isBeaconB(buf);
}

function decodeA(buf) {
  const ip      = `${buf[4]}.${buf[5]}.${buf[6]}.${buf[7]}`;
  const counter = (buf[10] << 8) | buf[11];
  const roomBed = readNullString(buf, 12);
  const { area, bed } = splitRoomBed(roomBed);
  return { type: 'A', port: 7000, ip, counter, roomBed, area, bed };
}

function decodeB(buf) {
  const destIp   = `${buf[0]}.${buf[1]}.${buf[2]}.${buf[3]}`;
  const destPort = (buf[4] << 8) | buf[5];
  const ip       = `${buf[6]}.${buf[7]}.${buf[8]}.${buf[9]}`;
  const srcPort  = (buf[10] << 8) | buf[11];
  const roomBed  = readNullString(buf, 24);
  const { area, bed } = splitRoomBed(roomBed);
  return { type: 'B', port: 7001, ip, srcPort, destIp, destPort, roomBed, area, bed };
}

function decode(buf) {
  if (isBeaconA(buf)) return decodeA(buf);
  if (isBeaconB(buf)) return decodeB(buf);
  return null;
}

// ─── helpers ─────────────────────────────────────────────────────────────────
function readNullString(buf, start) {
  let s = '';
  for (let i = start; i < buf.length; i++) {
    if (buf[i] === 0) break;
    s += String.fromCharCode(buf[i]);
  }
  return s;
}

function splitRoomBed(roomBed) {
  const parts = roomBed.split('|');
  return { area: parts[0] || '', bed: parts[1] || roomBed };
}

module.exports = { isBeacon, isBeaconA, isBeaconB, decode, decodeA, decodeB, TYPE_A_SIZE, TYPE_B_SIZE };
