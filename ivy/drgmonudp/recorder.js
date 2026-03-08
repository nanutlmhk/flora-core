'use strict';

const fs   = require('fs');
const path = require('path');

class Recorder {
  constructor(sessionDir) {
    this.sessionDir   = sessionDir;
    this.rawDir       = path.join(sessionDir, 'raw');
    this.packetCount  = 0;

    fs.mkdirSync(this.rawDir, { recursive: true });

    // JSONL: one parsed record per line — easy to grep / stream later
    this.parsedStream = fs.createWriteStream(
      path.join(sessionDir, 'parsed.jsonl'),
      { flags: 'a' }
    );
  }

  record(buf, parsed) {
    this.packetCount++;
    const ts  = new Date().toISOString();
    const idx = String(this.packetCount).padStart(6, '0');

    // --- raw binary ---
    const binPath = path.join(this.rawDir, `${idx}.bin`);
    fs.writeFileSync(binPath, buf);

    // --- hex dump (human-readable) ---
    const hexPath = path.join(this.rawDir, `${idx}.hex`);
    fs.writeFileSync(hexPath, hexDump(buf, ts));

    // --- parsed JSONL (strip wave arrays to length to keep file small) ---
    const compact = compactParsed(parsed);
    this.parsedStream.write(JSON.stringify({ ts, idx, size: buf.length, parsed: compact }) + '\n');

    return { ts, idx };
  }

  close() {
    this.parsedStream.end();
    console.log(`\nSession closed. ${this.packetCount} packets saved to ${this.sessionDir}`);
  }
}

// Build a standard hex dump string
function hexDump(buf, ts) {
  const lines = [`Timestamp : ${ts}`, `Size      : ${buf.length} bytes`, ''];
  for (let i = 0; i < buf.length; i += 16) {
    const slice    = buf.slice(i, i + 16);
    const hexPart  = Array.from(slice)
      .map(b => b.toString(16).padStart(2, '0'))
      .join(' ')
      .padEnd(47);
    const asciiPart = Array.from(slice)
      .map(b => (b >= 32 && b < 127) ? String.fromCharCode(b) : '.')
      .join('');
    lines.push(`${i.toString(16).padStart(4, '0')}  ${hexPart}  ${asciiPart}`);
  }
  return lines.join('\n') + '\n';
}

// Replace wave arrays with their lengths to keep JSONL compact
function compactParsed(parsed) {
  const out = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (Array.isArray(v)) {
      out[k] = `[wave:${v.length}samples]`;
    } else {
      out[k] = v;
    }
  }
  return out;
}

module.exports = Recorder;
