const { framePacket } = require("./framing");
const CFG = require("./config");

// S/5 Computer Interface Protocol — Little-Endian binary protocol
//
// A "Datex Record" request is exactly 49 bytes, laid out as follows:
//
//  Offset  Size  Field              Notes
//  ------  ----  -----------------  -------------------------------------------
//   0-1     2    r_len (LE)         = 49 (0x31 0x00)
//   2       1    r_maintype         = 0 (per spec example)
//   3-21   19    reserved / zeros   sr_desc array (no subrecords used in request)
//   22-23   2    EOL marker (LE)    = 0x00FF  (DRI_EOL_SUBR_LIST = 255)
//   24-39  16    padding zeros
//   40      1    phdb_rcrd_type     = 1 (DRI_PH_DISPL)
//   41-42   2    tx_ival (LE)       auto-transmission interval in seconds (min 5)
//   43-46   4    phdb_class_bf (LE) bitmask of data classes to request
//   47-48   2    reserved           = 0
//
// Verified against spec example (M1017617 Appendix A):
//   7e 31 00 00...00 ff 00 00...00 01 0a 00 0e 00 00 00 00 00 49 7e
//   checksum: 49+255+1+10+14 = 329 & 0xFF = 0x49 ✓

const RECORD_LEN        = 49;
const DRI_EOL_SUBR_LIST = 0xFF; // end-of-subrecord-list marker at bytes 22-23

// phdb_class_bf bitmask (from VSCaptureWave DataConstants.cs):
//   bit 0 = 0 → INCLUDE basic (default, REQ_BASIC_MASK = 0)
//   bit 0 = 1 → DENY basic   (DENY_BASIC_MASK = 1)
//   bit 1 = 1 → EXT1  (REQ_EXT1_MASK = 2)
//   bit 2 = 1 → EXT2  (REQ_EXT2_MASK = 4)
//   bit 3 = 1 → EXT3  (REQ_EXT3_MASK = 8)
//
// Spec example (Appendix A) shows 0x0E = BASIC+EXT1+EXT2+EXT3.
// However the B650 unit under test ONLY responded when sent 0x0F (all four bits set).
// 0x0E = BASIC + EXT1 + EXT2 + EXT3 (bit 0 clear = include basic, matches spec Appendix A)
// 0x0F = EXT1+EXT2+EXT3 only (bit 0=1 = DENY_BASIC_MASK — HR/SpO2/NIBP not sent!)
const PHDB_CLASS_ALL = 0x0E; // include BASIC so HR, SpO2, NIBP are streamed

/**
 * Build a DRI_PH_DISPL auto-transmission request packet.
 *
 * intervalSeconds — how often the device should send PHDB data (seconds).
 *   Spec minimum for DRI_PH_DISPL is 5 seconds; values below 5 are clamped.
 *
 * Returns a framed, escaped, checksummed Buffer ready to write to serial.
 */
function buildDisplayRequest(intervalSeconds = 5) {
  const ival = Math.max(5, Math.round(intervalSeconds));
  const record = Buffer.alloc(RECORD_LEN, 0);

  // ── Datex record header ────────────────────────────────────────────────────
  record.writeUInt16LE(RECORD_LEN, 0);         // r_len (LE) = 49
  // record[2] = 0  →  r_maintype (zero per spec example; NOT DRI_MT_PHDB=4)

  // ── Sub-record descriptor list ─────────────────────────────────────────────
  // No explicit sub-records in a phdb request. Terminate with EOL marker.
  record.writeUInt16LE(DRI_EOL_SUBR_LIST, 22); // 0xFF 0x00 at bytes 22-23

  // ── phdb_req body (starts at byte 40) ─────────────────────────────────────
  record[40] = CFG.DRI_PH_DISPL;              // phdb_rcrd_type = 1
  record.writeInt16LE(ival, 41);              // tx_ival (LE), seconds
  record.writeUInt32LE(PHDB_CLASS_ALL, 43);   // phdb_class_bf (LE)
  record.writeUInt16LE(0, 47);               // reserved

  return framePacket(record);
}

module.exports = { buildDisplayRequest };
