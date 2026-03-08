// 8-bit unsigned sum of all bytes in the payload
function computeChecksum(buffer) {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    sum = (sum + buffer[i]) & 0xff;
  }
  return sum;
}

// Framing Constants
const FLAG = 0x7e;
const ESC = 0x7d;
const ESC_MASK = 0x20;

// Wraps payload in 0x7E frame with escaping and checksum
function framePacket(payload) {
  const chk = computeChecksum(payload);
  const withChk = Buffer.concat([payload, Buffer.from([chk])]);
  
  const chunks = [Buffer.from([FLAG])];
  
  for (let i = 0; i < withChk.length; i++) {
    const b = withChk[i];
    if (b === FLAG || b === ESC) {
      chunks.push(Buffer.from([ESC, b & ~ESC_MASK])); // Spec says "clear 5th bit" -> 0x5E/0x5D
    } else {
      chunks.push(Buffer.from([b]));
    }
  }
  
  chunks.push(Buffer.from([FLAG]));
  return Buffer.concat(chunks);
}

// Unescapes a buffer (strips 0x7D)
// Input should be the content BETWEEN the 0x7E flags
function unescapePacket(buffer) {
  const output = [];
  let escapeNext = false;
  
  for (let i = 0; i < buffer.length; i++) {
    const b = buffer[i];
    
    if (b === ESC) {
      escapeNext = true;
      continue;
    }
    
    if (escapeNext) {
      // Spec: "restore the 5th bit" -> OR 0x20
      output.push(b | ESC_MASK);
      escapeNext = false;
    } else {
      output.push(b);
    }
  }
  
  return Buffer.from(output);
}

module.exports = { computeChecksum, framePacket, unescapePacket };
