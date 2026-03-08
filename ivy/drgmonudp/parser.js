'use strict';

// Direct translation of the Ruby IACS module parser
// Value encoding: custom signed 16-bit, NOT standard two's complement
//   a <= 200 -> positive:  x = 256*a + b
//   a >  200 -> negative:  x = -256*(256-a) + b
//   (e.g. a=255,b=255 -> -1, likely means "unavailable")

function getVal(l, start) {
  if (l.length > start + 1) {
    const a = l[start];
    const b = l[start + 1];
    let x = 256 * a + b;
    if (a > 200) x = -256 * (256 - a) + b;
    return x;
  }
  return null;
}

function getList(l, start, len) {
  const set = [];
  for (let i = 0; i < len; i++) {
    const a = l[start + i * 2];
    const b = l[start + i * 2 + 1];
    if (a !== undefined) {
      let x = 256 * a + b;
      if (a > 200) x = -256 * (256 - a) + b;
      set.push(x);
    }
  }
  return set;
}

// Tag is formed by joining two bytes as decimal strings (mirrors Ruby's Array#join)
// e.g. bytes [0,12] -> "012",  [0,200] -> "0200",  [0,100] -> "0100"
function makeTag(l, pos) {
  return `${l[pos]}${l[pos + 1]}`;
}

function parse(buf) {
  const l = buf instanceof Buffer ? Array.from(buf) : buf;
  if (!l || l.length === 0) return {};

  const ip   = l.slice(12, 16).join('.');
  const map  = { _ip: ip, _size: l.length };
  const waveKey = {};

  let pos   = 32; // startup offset
  let count = 5000;

  while (pos < l.length && count > 0) {
    const tag = makeTag(l, pos);
    let key = null;
    let len = null;
    let res = null;

    if (tag === '012') {
      len = 12;

    } else if (tag === '0200') {
      // wave 40 samples
      res = getList(l, pos + 14, 40);
      key = `${l[pos + 10]}-${l[pos + 11]}`;
      waveKey[key] = 40;
      len = 94;

    } else if (tag === '0100') {
      // wave 20 samples — SpO2 pleth
      res = getList(l, pos + 14, 20);
      key = `${l[pos + 10]}-${l[pos + 11]}`;
      waveKey[key] = 20;
      len = 54;

    } else if (tag === '050') {
      // wave 10 samples
      res = getList(l, pos + 14, 10);
      key = `${l[pos + 10]}-${l[pos + 11]}`;
      waveKey[key] = 10;
      len = 34;

    } else if (tag === '014') {
      // numeric block — cx records of 36 bytes each
      len = 6;
      const cx   = l[pos + 4];
      const base = pos + len;
      for (let x = 0; x < cx; x++) {
        const val = getVal(l, base + x * 36);
        const k   = l.slice(base + x * 36 + 20, base + x * 36 + 25).join('-');
        map[k] = val;
      }
      key = null;
      len += cx * 36;

    } else if (tag === '00' || tag === '0120') {
      // single numeric key-value
      res = getVal(l, pos + 30);
      key = l.slice(pos + 14, pos + 19).join('-');
      len = 36;

    } else if (tag === '018') {
      // warning / alert text
      len = 130;
      const s = [];
      for (let i = 0; i < 24; i++) {
        if (l[pos + i * 2 + 5] === 0) break;
        s.push(String.fromCharCode(l[pos + i * 2 + 5]));
      }
      if (s.length > 0) map['msg'] = s.join('');

    } else if (tag === '010') {
      // bed / hostname — absolute position 65 in full packet
      len = 116;
      const s = [];
      for (let i = 0; i < 8; i++) {
        if (l[i * 2 + 65] === 0) break;
        s.push(String.fromCharCode(l[i * 2 + 65]));
      }
      map['bed'] = s.join('').trim();

    } else if (tag === '015') {
      len = 252;

    } else if (tag === '024') {
      len = 194;

    } else {
      // unknown tag — stop parsing this packet
      break;
    }

    if (key !== null && res !== null) {
      map[key] = res;
    }

    if (len) pos += len;
    count--;
  }

  map['wave_key'] = waveKey;
  return map;
}

module.exports = { parse, getVal, getList };
