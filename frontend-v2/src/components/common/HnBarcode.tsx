import { useMemo } from "react";

type HnBarcodeProps = {
  value: string;
  height?: number;
  className?: string;
  showText?: boolean;
};

type EncodedSequence = {
  digits: string;
  bars: Array<{ x: number; width: number }>;
  totalWidth: number;
};

const DIGIT_PATTERN: Record<string, string> = {
  "0": "nnwwn",
  "1": "wnnnw",
  "2": "nwnnw",
  "3": "wwnnn",
  "4": "nnwnw",
  "5": "wnwnn",
  "6": "nwwnn",
  "7": "nnnww",
  "8": "wnnwn",
  "9": "nwnwn",
};

function toDigits(raw: string): string {
  return String(raw || "").replace(/\D+/g, "");
}

function encodeInterleaved2of5(raw: string): EncodedSequence | null {
  let digits = toDigits(raw);
  if (!digits) return null;
  if (digits.length % 2 === 1) digits = `0${digits}`;

  const narrow = 2;
  const wide = 5;
  const quiet = 10;

  const widths: number[] = [];
  const push = (symbol: string) => widths.push(symbol === "w" ? wide : narrow);

  // Start: narrow bar, narrow space, narrow bar, narrow space
  push("n");
  push("n");
  push("n");
  push("n");

  for (let i = 0; i < digits.length; i += 2) {
    const left = DIGIT_PATTERN[digits[i]];
    const right = DIGIT_PATTERN[digits[i + 1]];
    for (let bit = 0; bit < 5; bit += 1) {
      push(left[bit]); // bar
      push(right[bit]); // space
    }
  }

  // Stop: wide bar, narrow space, narrow bar
  push("w");
  push("n");
  push("n");

  const bars: Array<{ x: number; width: number }> = [];
  let x = quiet;
  let isBar = true;
  for (const width of widths) {
    if (isBar) bars.push({ x, width });
    x += width;
    isBar = !isBar;
  }

  return {
    digits,
    bars,
    totalWidth: x + quiet,
  };
}

export default function HnBarcode({
  value,
  height = 44,
  className = "",
  showText = true,
}: HnBarcodeProps) {
  const encoded = useMemo(() => encodeInterleaved2of5(value), [value]);
  if (!encoded) return null;

  return (
    <div
      className={`rounded border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-950/60 px-2 py-1 ${className}`.trim()}
    >
      <svg
        role="img"
        aria-label={`HN barcode ${encoded.digits}`}
        viewBox={`0 0 ${encoded.totalWidth} ${height}`}
        className="w-full"
        style={{ height: `${height}px` }}
      >
        <rect x={0} y={0} width={encoded.totalWidth} height={height} fill="transparent" />
        {encoded.bars.map((bar, idx) => (
          <rect
            key={idx}
            x={bar.x}
            y={0}
            width={bar.width}
            height={height}
            fill="currentColor"
          />
        ))}
      </svg>
      {showText ? (
        <div className="text-[10px] leading-4 text-center tracking-[0.22em] text-gray-700 dark:text-gray-300">
          {encoded.digits}
        </div>
      ) : null}
    </div>
  );
}
