import { useMemo } from "react";

type HnQrCodeProps = {
  value: string;
  size?: number;
  className?: string;
  showText?: boolean;
};

type Matrix = boolean[][];

const QR_SIZE = 21; // Version 1
const DATA_CODEWORDS = 19; // Version 1-L
const ECC_CODEWORDS = 7; // Version 1-L

function toDigits(raw: string): string {
  return String(raw || "").replace(/\D+/g, "");
}

function appendBits(bits: number[], value: number, length: number) {
  for (let i = length - 1; i >= 0; i -= 1) {
    bits.push((value >>> i) & 1);
  }
}

function gfTables() {
  const exp = new Array<number>(512).fill(0);
  const log = new Array<number>(256).fill(0);
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    exp[i] = x;
    log[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) exp[i] = exp[i - 255];
  return { exp, log };
}

const GF = gfTables();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF.exp[GF.log[a] + GF.log[b]];
}

function rsGenerator(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], GF.exp[i]);
    }
    poly = next;
  }
  return poly.slice(1);
}

function rsEncode(data: number[], ecLen: number): number[] {
  const gen = rsGenerator(ecLen);
  const ec = new Array<number>(ecLen).fill(0);
  for (const d of data) {
    const factor = d ^ ec[0];
    for (let i = 0; i < ecLen - 1; i += 1) ec[i] = ec[i + 1];
    ec[ecLen - 1] = 0;
    for (let i = 0; i < ecLen; i += 1) ec[i] ^= gfMul(gen[i], factor);
  }
  return ec;
}

function encodeNumericData(digits: string): number[] | null {
  if (!digits) return null;
  if (digits.length > 41) return null; // Version 1-L numeric max

  const bits: number[] = [];
  appendBits(bits, 0b0001, 4); // Numeric mode
  appendBits(bits, digits.length, 10); // Char count for v1-9

  for (let i = 0; i < digits.length; i += 3) {
    const chunk = digits.slice(i, i + 3);
    const n = Number(chunk);
    if (chunk.length === 3) appendBits(bits, n, 10);
    else if (chunk.length === 2) appendBits(bits, n, 7);
    else appendBits(bits, n, 4);
  }

  const capacityBits = DATA_CODEWORDS * 8;
  const terminator = Math.min(4, capacityBits - bits.length);
  for (let i = 0; i < terminator; i += 1) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j += 1) b = (b << 1) | bits[i + j];
    data.push(b);
  }

  let padIndex = 0;
  const pads = [0xec, 0x11];
  while (data.length < DATA_CODEWORDS) {
    data.push(pads[padIndex % 2]);
    padIndex += 1;
  }

  return data;
}

function createMatrix(size: number): { matrix: Matrix; reserved: boolean[][] } {
  return {
    matrix: Array.from({ length: size }, () => Array<boolean>(size).fill(false)),
    reserved: Array.from({ length: size }, () => Array<boolean>(size).fill(false)),
  };
}

function mark(
  matrix: Matrix,
  reserved: boolean[][],
  x: number,
  y: number,
  dark: boolean,
) {
  if (x < 0 || y < 0 || y >= matrix.length || x >= matrix.length) return;
  matrix[y][x] = dark;
  reserved[y][x] = true;
}

function drawFinder(
  matrix: Matrix,
  reserved: boolean[][],
  left: number,
  top: number,
) {
  for (let dy = -1; dy <= 7; dy += 1) {
    for (let dx = -1; dx <= 7; dx += 1) {
      const x = left + dx;
      const y = top + dy;
      if (x < 0 || y < 0 || x >= QR_SIZE || y >= QR_SIZE) continue;
      const isBorder = dx === -1 || dx === 7 || dy === -1 || dy === 7;
      const isOuter = dx === 0 || dx === 6 || dy === 0 || dy === 6;
      const isInner = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
      mark(matrix, reserved, x, y, isBorder ? false : isOuter || isInner);
    }
  }
}

function drawFunctionPatterns(matrix: Matrix, reserved: boolean[][]) {
  drawFinder(matrix, reserved, 0, 0);
  drawFinder(matrix, reserved, QR_SIZE - 7, 0);
  drawFinder(matrix, reserved, 0, QR_SIZE - 7);

  for (let i = 8; i < QR_SIZE - 8; i += 1) {
    mark(matrix, reserved, i, 6, i % 2 === 0);
    mark(matrix, reserved, 6, i, i % 2 === 0);
  }

  // Reserve format information cells.
  for (let i = 0; i < 9; i += 1) {
    if (i !== 6) {
      reserved[8][i] = true;
      reserved[i][8] = true;
    }
  }
  for (let i = 0; i < 8; i += 1) {
    reserved[8][QR_SIZE - 1 - i] = true;
    reserved[QR_SIZE - 1 - i][8] = true;
  }
  reserved[8][QR_SIZE - 8] = true;

  // Fixed dark module.
  mark(matrix, reserved, 8, QR_SIZE - 8, true);
}

function formatBitsForLMask0(): number {
  const eclL = 0b01;
  const mask = 0b000;
  const data = (eclL << 3) | mask;
  let rem = data << 10;
  const poly = 0x537;
  for (let i = 14; i >= 10; i -= 1) {
    if (((rem >>> i) & 1) !== 0) rem ^= poly << (i - 10);
  }
  return (((data << 10) | rem) ^ 0x5412) & 0x7fff;
}

function drawFormatInfo(matrix: Matrix, reserved: boolean[][]) {
  const bits = formatBitsForLMask0();
  const bit = (i: number) => ((bits >>> i) & 1) === 1;

  for (let i = 0; i <= 5; i += 1) mark(matrix, reserved, 8, i, bit(i));
  mark(matrix, reserved, 8, 7, bit(6));
  mark(matrix, reserved, 8, 8, bit(7));
  mark(matrix, reserved, 7, 8, bit(8));
  for (let i = 9; i <= 14; i += 1) mark(matrix, reserved, 14 - i, 8, bit(i));

  for (let i = 0; i <= 7; i += 1) mark(matrix, reserved, QR_SIZE - 1 - i, 8, bit(i));
  for (let i = 8; i <= 14; i += 1) mark(matrix, reserved, 8, QR_SIZE - 15 + i, bit(i));
  mark(matrix, reserved, 8, QR_SIZE - 8, true);
}

function placeData(matrix: Matrix, reserved: boolean[][], bits: number[]) {
  let idx = 0;
  let upward = true;
  for (let right = QR_SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right -= 1;
    for (let step = 0; step < QR_SIZE; step += 1) {
      const y = upward ? QR_SIZE - 1 - step : step;
      for (let dx = 0; dx < 2; dx += 1) {
        const x = right - dx;
        if (reserved[y][x]) continue;
        matrix[y][x] = idx < bits.length ? bits[idx] === 1 : false;
        idx += 1;
      }
    }
    upward = !upward;
  }
}

function applyMask0(matrix: Matrix, reserved: boolean[][]) {
  for (let y = 0; y < QR_SIZE; y += 1) {
    for (let x = 0; x < QR_SIZE; x += 1) {
      if (reserved[y][x]) continue;
      if ((x + y) % 2 === 0) matrix[y][x] = !matrix[y][x];
    }
  }
}

function buildQrMatrix(raw: string): { digits: string; matrix: Matrix } | null {
  const digits = toDigits(raw);
  const data = encodeNumericData(digits);
  if (!digits || !data) return null;

  const ec = rsEncode(data, ECC_CODEWORDS);
  const allBytes = [...data, ...ec];
  const bits: number[] = [];
  for (const b of allBytes) appendBits(bits, b, 8);

  const { matrix, reserved } = createMatrix(QR_SIZE);
  drawFunctionPatterns(matrix, reserved);
  placeData(matrix, reserved, bits);
  applyMask0(matrix, reserved);
  drawFormatInfo(matrix, reserved);

  return { digits, matrix };
}

export default function HnQrCode({
  value,
  size = 98,
  className = "",
  showText = false,
}: HnQrCodeProps) {
  const data = useMemo(() => buildQrMatrix(value), [value]);
  if (!data) return null;

  const quiet = 4;
  const full = QR_SIZE + quiet * 2;
  return (
    <div
      className={`rounded border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-950/60 px-2 py-1 ${className}`.trim()}
    >
      <svg
        role="img"
        aria-label={`HN QR ${data.digits}`}
        viewBox={`0 0 ${full} ${full}`}
        className="block"
        style={{ width: `${size}px`, height: `${size}px` }}
      >
        <rect x={0} y={0} width={full} height={full} fill="white" />
        {data.matrix.map((row, y) =>
          row.map((dark, x) =>
            dark ? (
              <rect
                key={`${x}-${y}`}
                x={x + quiet}
                y={y + quiet}
                width={1}
                height={1}
                fill="black"
              />
            ) : null,
          ),
        )}
      </svg>
      {showText ? (
        <div className="text-[10px] leading-4 text-center tracking-[0.1em] text-gray-700 dark:text-gray-300">
          {data.digits}
        </div>
      ) : null}
    </div>
  );
}
