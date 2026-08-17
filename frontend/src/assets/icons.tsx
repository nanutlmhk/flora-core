import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base: IconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": "true",
};

/** Start ANE — Zzz (patient going to sleep) */
export function StartAnesthesiaIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      {/* Large Z */}
      <path d="M3 16h6L3 22h6" />
      {/* Medium Z */}
      <path d="M8 9h6L8 15h6" />
      {/* Small Z */}
      <path d="M13 3h5L13 8h5" />
    </svg>
  );
}

/** Induction — vertical syringe */
export function InductionIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      {/* barrel */}
      <rect x="9" y="4" width="6" height="12" rx="1" />
      {/* plunger rod */}
      <line x1="12" y1="4" x2="12" y2="2" />
      {/* plunger handle */}
      <line x1="10" y1="2" x2="14" y2="2" />
      {/* needle */}
      <line x1="12" y1="16" x2="12" y2="21" />
      {/* liquid level */}
      <line x1="9" y1="9" x2="15" y2="9" />
    </svg>
  );
}

/** SSI Prophylaxis — pill capsule */
export function AntibioticIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="9" width="18" height="6" rx="3" />
      <line x1="12" y1="9" x2="12" y2="15" />
    </svg>
  );
}

/** Time Out — clock */
export function TimeoutIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 15" />
    </svg>
  );
}

/** Start Surgery — scalpel (diagonal blade) */
export function StartSurgeryIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      {/* handle */}
      <line x1="4" y1="20" x2="14" y2="10" />
      {/* blade spine */}
      <path d="M14 10l5-5" />
      {/* blade belly — curved cutting edge */}
      <path d="M14 10c1-3 4-5 5-5" />
      {/* blade tip dot */}
      <circle cx="19" cy="5" r="0.5" fill="currentColor" />
    </svg>
  );
}

/** End Surgery — scissors */
export function EndSurgeryIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <line x1="20" y1="4" x2="8.12" y2="15.88" />
      <line x1="14.47" y1="14.48" x2="20" y2="20" />
      <line x1="8.12" y1="8.12" x2="12" y2="12" />
    </svg>
  );
}

/** Reversal — counter-clockwise rotation arrow */
export function ReversalIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 .49-4.89" />
    </svg>
  );
}

/** End ANE — eye (patient waking up) */
export function EndAnesthesiaIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** Note — file with text lines */
export function NoteIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

/** Blood — blood droplet */
export function BloodIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
    </svg>
  );
}
