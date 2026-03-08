function computeChecksum(buf) {
  let b = 0;
  for (const v of buf) b += v;
  return (128 + (~b + 1)) & 127;
}

module.exports = { computeChecksum };
