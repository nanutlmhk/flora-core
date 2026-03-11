const { framePacket } = require("./framing");
const CFG = require("./config");

// S/5 DRI header layout (datex_hdr_type, Pack=1, 40 bytes total):
//   0-1   r_len (Int16 LE)       = 49 for phdb request
//   2     r_nbr (byte)           = 0
//   3     r_dri_level (byte)     ← MUST match device firmware level
//   4-5   plug_id (UInt16)       = 0
//   6-9   r_time (UInt32)        = 0
//   10-13 reserved               = 0
//   14-15 r_maintype (Int16 LE)  = 0 (DRI_MT_PHDB)
//   16-18 sr_desc[0]: offset(Int16)=0, type(byte)=0  (phdb data request)
//   19-21 sr_desc[1]: offset(Int16)=0, type(byte)=0xFF (EOL)
//   22-39 padding zeros
//   40    phdb_rcrd_type (byte)  = 1 (DRI_PH_DISPL)
//   41-42 tx_interval (Int16 LE) = interval seconds
//   43-46 phdb_class_bf (UInt32 LE)
//   47-48 reserved               = 0
//
// Verified against spec Appendix A hex example:
//   7e 31 00 [level] 00 00...00 ff 00...00 01 0a 00 0e 00 00 00 00 00 [chk] 7e

const RECORD_LEN        = 49;
const DRI_EOL_SUBR_LIST = 0xFF;

// DRI firmware level codes (from DataConstants.cs):
const DRI_LEVEL_2001 = 7;
const DRI_LEVEL_2003 = 8;
const DRI_LEVEL_2005 = 9;

// phdb_class_bf (from DataConstants.cs):
//   DRI_PHDBCL_REQ_BASIC_MASK = 0  (bit0=0 → include BASIC, this is the default)
//   DRI_PHDBCL_REQ_EXT1_MASK  = 2
//   DRI_PHDBCL_REQ_EXT2_MASK  = 4
//   DRI_PHDBCL_REQ_EXT3_MASK  = 8
// 0x0E = 0|2|4|8 = BASIC + EXT1 + EXT2 + EXT3
const PHDB_CLASS_ALL = 0x0E;

/**
 * Build one DRI_PH_DISPL request packet for a specific DRI firmware level.
 * Returns a framed, escaped, checksummed Buffer.
 */
function buildDisplayRequest(intervalSeconds = 5, driLevel = DRI_LEVEL_2005) {
  const ival   = Math.max(5, Math.round(intervalSeconds));
  const record = Buffer.alloc(RECORD_LEN, 0);

  record.writeUInt16LE(RECORD_LEN, 0);       // r_len
  record[3] = driLevel;                       // r_dri_level ← key field
  record.writeUInt16LE(DRI_EOL_SUBR_LIST, 19); // sr_desc[1].sr_offset low byte = 0xFF = EOL
  record[40] = CFG.DRI_PH_DISPL;             // phdb_rcrd_type = 1
  record.writeInt16LE(ival, 41);             // tx_interval
  record.writeUInt32LE(PHDB_CLASS_ALL, 43);  // phdb_class_bf

  return framePacket(record);
}

/**
 * Build three DRI_PH_DISPL requests — one per firmware level (2001/2003/2005).
 *
 * VSCaptureWave (Main.cs) sends all three back-to-back on startup because the
 * B650 / Aisys monitor only responds to the request that matches its own
 * r_dri_level. Sending all three guarantees a response regardless of firmware.
 *
 * Returns a single Buffer with all three framed packets concatenated.
 */
function buildAllLevelRequests(intervalSeconds = 5) {
  return Buffer.concat([
    buildDisplayRequest(intervalSeconds, DRI_LEVEL_2005), // level 9
    buildDisplayRequest(intervalSeconds, DRI_LEVEL_2003), // level 8
    buildDisplayRequest(intervalSeconds, DRI_LEVEL_2001), // level 7
  ]);
}

module.exports = { buildDisplayRequest, buildAllLevelRequests };
