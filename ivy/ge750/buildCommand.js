const { computeChecksum } = require("./checksum");

function buildCmd(cmdAscii) {
  const body = Buffer.from(cmdAscii, "ascii");
  const withEsc = Buffer.concat([Buffer.from([0x1b]), body]);
  const chk = computeChecksum(withEsc); // matches C#: checksum over ESC + body

  return Buffer.concat([
    Buffer.from([0x1b]), // ESC
    body,
    Buffer.from([chk]),
    Buffer.from([0x0d])  // CR
  ]);
}

module.exports = { buildCmd };
