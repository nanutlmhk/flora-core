import { useEffect, useState } from "react";

/**
 * Decorative sign-in background: Flora Root's branching network in two shapes.
 *   tree   (Canopy) - Root turned upside down: branches rise from a seed at the bottom;
 *                     the glowing tips are the Leaves that sync into Canopy.
 *   flower (Leaf)   - branches open from the centre in clusters, like petals.
 * Sparks travel along the branches. Same seed every visit; colours come from the
 * active app theme (--app-*).
 */

export type NetworkShape = "tree" | "flower";

type Branch = { d: string; width: number; spark?: { duration: number; begin: number } };
type Tip = { x: number; y: number; delay: number };

function random(seed: number) {
  let state = seed;
  return () => (state = (state * 16807) % 2147483647) / 2147483647;
}

function buildNetwork(W: number, H: number, shape: NetworkShape) {
  const rnd = random(7);
  const branches: Branch[] = [];
  const ends: { x: number; y: number; group: number }[] = [];
  let group = 0;
  const origin = shape === "flower" ? { x: W / 2, y: H / 2 } : { x: W / 2, y: H + 20 };

  function grow(x: number, y: number, angle: number, length: number, depth: number, width: number) {
    if (depth === 0 || y < -40) {
      ends.push({ x, y, group });
      return;
    }
    const x2 = x + Math.cos(angle) * length;
    const y2 = y + Math.sin(angle) * length;
    const cx = x + Math.cos(angle + (rnd() - 0.5) * 0.9) * length * 0.6;
    const cy = y + Math.sin(angle + (rnd() - 0.5) * 0.9) * length * 0.6;
    const branch: Branch = { d: `M${x.toFixed(1)},${y.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`, width };
    if (depth >= 3 && rnd() > 0.45) branch.spark = { duration: 3 + rnd() * 4, begin: rnd() * 4 };
    branches.push(branch);
    const children = shape === "flower" ? (depth > 3 || rnd() > 0.55 ? 2 : 1) : depth > 3 ? 2 : rnd() > 0.35 ? 2 : 1;
    // Petals stay narrow so each cluster reads as one petal; tree branches fan out wider.
    const fan = shape === "flower" ? 0.22 + rnd() * 0.18 : 0.55 + rnd() * 0.35;
    for (let i = 0; i < children; i++) {
      grow(x2, y2, angle + (i - (children - 1) / 2) * fan + (rnd() - 0.5) * (shape === "flower" ? 0.12 : 0.3),
        length * (0.78 + rnd() * 0.12), depth - 1, Math.max(0.6, width * 0.72));
    }
  }

  if (shape === "flower") {
    // Seven petals, each a narrow bundle of branches leaving the centre together.
    const petals = 7;
    const reach = Math.hypot(W, H) / 2;
    for (let p = 0; p < petals; p++) {
      group = p;
      const heading = -Math.PI / 2 + (p * 2 * Math.PI) / petals;
      for (let k = 0; k < 2; k++) grow(origin.x, origin.y, heading + (k - 0.5) * 0.14, reach * 0.24, 5, 2.4);
    }
  } else {
    const spread = Math.min(1.25, (W / H) * 0.75);
    for (let i = 0; i < 5; i++) grow(origin.x, origin.y, -Math.PI / 2 + (i - 2) * spread * 0.32, Math.min(W, H) * 0.2, 6, 3.2);
  }

  // Glowing tips that stay on screen: the upper page for the tree, the outer ring for the flower.
  const onScreen = ends.filter(p => p.x > 30 && p.x < W - 30 && p.y > 20 && p.y < H - 20);
  const picked = shape === "flower"
    // Three tips per petal, spread along it, so the bloom glows evenly all round.
    ? Array.from({ length: 7 }, (_, petal) => {
        const own = onScreen.filter(p => p.group === petal && Math.hypot(p.x - origin.x, p.y - origin.y) > Math.min(W, H) * 0.3);
        return [0, 0.5, 1].map(f => own[Math.floor(f * (own.length - 1))]).filter(Boolean);
      }).flat()
    : onScreen.filter(p => p.y < H * 0.65).filter((_, i) => i % 3 === 0).slice(0, 14);
  const tips: Tip[] = picked.map((p, i) => ({ x: p.x, y: p.y, delay: (i * 0.37) % 4.8 }));
  return { branches, tips, seed: shape === "flower" ? origin : { x: origin.x, y: H - 6 } };
}

function useViewport() {
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    let timer = 0;
    const onResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setSize({ w: window.innerWidth, h: window.innerHeight }), 150);
    };
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("resize", onResize); window.clearTimeout(timer); };
  }, []);
  return size;
}

export default function BranchNetwork({ shape }: { shape: NetworkShape }) {
  const { w, h } = useViewport();
  const { branches, tips, seed } = buildNetwork(w, h, shape);
  return (
    <svg className="canopy-tree" viewBox={`0 0 ${w} ${h}`} aria-hidden="true" focusable="false">
      {branches.map((branch, index) => (
        <g key={index}>
          <path className="canopy-tree__branch" d={branch.d} strokeWidth={branch.width.toFixed(2)} />
          {branch.spark ? (
            <circle className="canopy-tree__spark" r="1.8">
              <animateMotion dur={`${branch.spark.duration.toFixed(1)}s`} begin={`${branch.spark.begin.toFixed(1)}s`}
                repeatCount="indefinite" path={branch.d} />
            </circle>
          ) : null}
        </g>
      ))}
      <circle className="canopy-tree__seed" cx={seed.x} cy={seed.y} r="10" />
      {tips.map((tip, index) => (
        <g key={index}>
          <circle className="canopy-tree__halo" cx={tip.x} cy={tip.y} r="4" style={{ animationDelay: `${tip.delay.toFixed(2)}s` }} />
          <circle className="canopy-tree__node" cx={tip.x} cy={tip.y} r="3.6" />
        </g>
      ))}
    </svg>
  );
}
