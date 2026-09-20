export type Rgb = { r: number; g: number; b: number };

export function parseHexColor(color: string): Rgb | null {
  const match = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return null;
  return {
    r: Number.parseInt(match[1].slice(0, 2), 16),
    g: Number.parseInt(match[1].slice(2, 4), 16),
    b: Number.parseInt(match[1].slice(4, 6), 16),
  };
}

export function mixRgb(from: Rgb, to: Rgb, amount: number): Rgb {
  return {
    r: Math.round(from.r + (to.r - from.r) * amount),
    g: Math.round(from.g + (to.g - from.g) * amount),
    b: Math.round(from.b + (to.b - from.b) * amount),
  };
}

function rgbToHex(color: Rgb) {
  return `#${[color.r, color.g, color.b].map(value => value.toString(16).padStart(2, "0")).join("")}`;
}

function relativeLuminance(color: Rgb) {
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

function contrastRatio(first: Rgb, second: Rgb) {
  const light = Math.max(relativeLuminance(first), relativeLuminance(second));
  const dark = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (light + 0.05) / (dark + 0.05);
}

export function smartContrastColor(color: string, background: Rgb, enabled: boolean) {
  if (!enabled) return color;
  const source = parseHexColor(color);
  if (!source || contrastRatio(source, background) >= 4.5) return color;
  const black = { r: 0, g: 0, b: 0 };
  const white = { r: 255, g: 255, b: 255 };
  const target = contrastRatio(black, background) >= contrastRatio(white, background) ? black : white;
  for (let amount = 0.1; amount <= 1; amount += 0.1) {
    const adjusted = mixRgb(source, target, amount);
    if (contrastRatio(adjusted, background) >= 4.5) return rgbToHex(adjusted);
  }
  return rgbToHex(target);
}
