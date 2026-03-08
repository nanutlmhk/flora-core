const envPort = process.env.GE750_PORT || process.env.GE750_COM_PORT || "COM6";
const envBaud = Number(process.env.GE750_BAUD || 19200);
const envDataBits = Number(process.env.GE750_DATA_BITS || 7);
const envStopBits = Number(process.env.GE750_STOP_BITS || 1);
const envParity = String(process.env.GE750_PARITY || "odd").toLowerCase();
const envPollMs = Number(process.env.GE750_POLL_MS || 1000);

module.exports = {
  PORT: envPort,

  BAUD_RATE: Number.isFinite(envBaud) ? envBaud : 19200,
  DATA_BITS: Number.isFinite(envDataBits) ? envDataBits : 7,
  STOP_BITS: Number.isFinite(envStopBits) ? envStopBits : 1,
  PARITY: envParity || "odd",
  POLL_MS: Number.isFinite(envPollMs) && envPollMs > 0 ? envPollMs : 1000,

  CMD_VTE: Buffer.from("VTE", "ascii"),
  CMD_VTX: Buffer.from("VTX", "ascii"),
  CMD_POLL: Buffer.from("VT?", "ascii"),

  RESP_START: 0x3a, // :
  RESP_END: 0x0d // CR
};
