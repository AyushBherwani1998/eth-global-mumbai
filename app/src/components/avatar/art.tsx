// Generated profile picture: flat geometric shapes on a 64-unit grid, picked
// deterministically from the wallet address. No library, no network, no canvas.
//
// The same address and variant always give the same picture. Colours are the
// company-mark tokens from globals.css, so an avatar follows light and dark the
// way every other surface in the app does. Twelve shape templates, ten
// palettes, four rotations: enough that two people never look alike, few enough
// that every one of them is a flat shape study and not noise.

import type { ReactNode } from "react";

// The neutral in each palette. --surface-2 rather than --surface, so a shape
// that touches the rim still reads as a shape and not a bite out of the circle.
const PAPER = "var(--surface-2)";

/** Palettes drawn from the mark tokens plus the brand and gain tokens. */
const PALETTES: [string, string, string][] = [
  ["var(--mark-acme)", "var(--mark-vayu)", "var(--mark-prakriti)"],
  ["var(--mark-kesar)", "var(--mark-masala)", "var(--mark-acme)"],
  ["var(--mark-tara)", "var(--mark-lotus)", "var(--mark-nirmaan)"],
  ["var(--mark-prakriti)", "var(--mark-acme)", "var(--mark-masala)"],
  ["var(--mark-nirmaan)", "var(--mark-vayu)", "var(--mark-tara)"],
  ["var(--brand)", "var(--mark-acme)", "var(--mark-nirmaan)"],
  ["var(--mark-lotus)", "var(--mark-kesar)", "var(--mark-tara)"],
  ["var(--mark-vayu)", "var(--mark-prakriti)", "var(--mark-acme)"],
  ["var(--mark-masala)", "var(--mark-lotus)", "var(--mark-kesar)"],
  ["var(--gain-text)", "var(--mark-prakriti)", "var(--mark-vayu)"],
];

type Ink = { bg: string; a: string; b: string; paper: string };
type Template = (ink: Ink, rand: () => number) => ReactNode[];

// --- deterministic hashing ---------------------------------------------------

function hash32(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** xorshift32, seeded from the hash. Same seed, same sequence, every time. */
function makeRand(seed: number) {
  let x = seed || 0x9e3779b9;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  };
}

// --- shape templates ---------------------------------------------------------

const quarters: Template = ({ a, b, paper }, rand) => {
  const corners = [
    "M0,0 L32,0 A32,32 0 0 1 0,32 Z",
    "M64,0 L64,32 A32,32 0 0 1 32,0 Z",
    "M64,64 L32,64 A32,32 0 0 1 64,32 Z",
    "M0,64 L0,32 A32,32 0 0 1 32,64 Z",
  ];
  const ink = [a, b, paper];
  return corners.map((d, i) => <path key={i} d={d} fill={ink[Math.floor(rand() * 3)]} />);
};

const arcs: Template = ({ a, b, paper }) =>
  [
    [52, a],
    [36, b],
    [20, paper],
  ].map(([r, fill], i) => <circle key={i} cx={32} cy={64} r={r as number} fill={fill as string} />);

const triangles: Template = ({ a, b, paper }, rand) => {
  const ink = [a, b, paper];
  const out: ReactNode[] = [];
  for (let gy = 0; gy < 2; gy += 1) {
    for (let gx = 0; gx < 2; gx += 1) {
      const x = gx * 32;
      const y = gy * 32;
      const shapes = [
        `M${x},${y} L${x + 32},${y} L${x},${y + 32} Z`,
        `M${x},${y} L${x + 32},${y} L${x + 32},${y + 32} Z`,
        `M${x + 32},${y} L${x + 32},${y + 32} L${x},${y + 32} Z`,
        `M${x},${y} L${x + 32},${y + 32} L${x},${y + 32} Z`,
      ];
      out.push(
        <path key={`${gx}-${gy}`} d={shapes[Math.floor(rand() * 4)]} fill={ink[Math.floor(rand() * 3)]} />,
      );
    }
  }
  return out;
};

const stripes: Template = ({ a, b, paper }) => (
  [
    [-16, a],
    [4, paper],
    [24, b],
    [44, paper],
  ].map(([y, fill], i) => (
    <rect key={i} x={-32} y={y as number} width={128} height={16} fill={fill as string} transform="rotate(45 32 32)" />
  ))
);

const orbit: Template = ({ a, b, paper }) => [
  <circle key="big" cx={24} cy={24} r={20} fill={a} />,
  <circle key="small" cx={47} cy={46} r={12} fill={b} />,
  <rect key="bar" x={0} y={54} width={64} height={10} fill={paper} />,
];

const cross: Template = ({ a, b, paper }) => [
  <rect key="v" x={24} y={0} width={16} height={64} fill={a} />,
  <rect key="h" x={0} y={24} width={64} height={16} fill={b} />,
  <circle key="d1" cx={12} cy={12} r={7} fill={paper} />,
  <circle key="d2" cx={52} cy={52} r={7} fill={paper} />,
];

const pie: Template = ({ a, b, paper }, rand) => {
  const wedges = [
    "M32,32 L58,32 A26,26 0 0 1 32,58 Z",
    "M32,32 L32,58 A26,26 0 0 1 6,32 Z",
    "M32,32 L6,32 A26,26 0 0 1 32,6 Z",
    "M32,32 L32,6 A26,26 0 0 1 58,32 Z",
  ];
  const ink = rand() > 0.5 ? [a, paper, b, paper] : [paper, a, paper, b];
  return wedges.map((d, i) => <path key={i} d={d} fill={ink[i]} />);
};

const chevrons: Template = ({ a, b, paper }) =>
  [
    [6, a],
    [24, paper],
    [42, b],
  ].map(([y, stroke], i) => (
    <path
      key={i}
      d={`M8,${y} L32,${(y as number) + 20} L56,${y}`}
      fill="none"
      stroke={stroke as string}
      strokeWidth={9}
      strokeLinecap="square"
      strokeLinejoin="miter"
    />
  ));

const columns: Template = ({ a, b, paper }, rand) => {
  const ink = [a, paper, b, paper];
  return [0, 1, 2, 3].map((i) => {
    const h = 16 + Math.floor(rand() * 36);
    return <rect key={i} x={6 + i * 14} y={64 - h} width={10} height={h} fill={ink[i]} />;
  });
};

const halfRounds: Template = ({ a, b, paper }, rand) => {
  const ink = [a, b, paper];
  const out: ReactNode[] = [];
  for (let gy = 0; gy < 2; gy += 1) {
    for (let gx = 0; gx < 2; gx += 1) {
      const x = gx * 32;
      const y = gy * 32;
      const faces = [
        `M${x},${y + 16} A16,16 0 0 1 ${x + 32},${y + 16} Z`,
        `M${x},${y + 16} A16,16 0 0 0 ${x + 32},${y + 16} Z`,
        `M${x + 16},${y} A16,16 0 0 0 ${x + 16},${y + 32} Z`,
        `M${x + 16},${y} A16,16 0 0 1 ${x + 16},${y + 32} Z`,
      ];
      out.push(<path key={`${gx}-${gy}`} d={faces[Math.floor(rand() * 4)]} fill={ink[Math.floor(rand() * 3)]} />);
    }
  }
  return out;
};

const diamond: Template = ({ a, paper }) => [
  <rect key="outer" x={14} y={14} width={36} height={36} fill={a} transform="rotate(45 32 32)" />,
  <rect key="inner" x={24} y={24} width={16} height={16} fill={paper} transform="rotate(45 32 32)" />,
];

const ring: Template = ({ a, b, paper }) => [
  <circle key="ring" cx={32} cy={32} r={22} fill="none" stroke={a} strokeWidth={14} />,
  <path key="notch" d="M32,32 L32,4 A28,28 0 0 1 60,32 Z" fill={paper} />,
  <circle key="dot" cx={32} cy={32} r={7} fill={b} />,
];

const TEMPLATES: Template[] = [
  quarters,
  arcs,
  triangles,
  stripes,
  orbit,
  cross,
  pie,
  chevrons,
  columns,
  halfRounds,
  diamond,
  ring,
];

/** How many different pictures the picker offers for one address. */
export const VARIANT_COUNT = 8;

// --- component ---------------------------------------------------------------

export function GeneratedAvatar({
  address,
  variant = 0,
  size = 36,
  className,
}: {
  address: string;
  variant?: number;
  size?: number;
  className?: string;
}) {
  // The address picks where the walk starts; the variant steps along it by a
  // stride coprime with the list length, so the eight choices the picker offers
  // are always eight different shapes in eight different palettes.
  const base = hash32(address.toLowerCase());
  const h = hash32(`${address.toLowerCase()}#${variant}`);
  const [bg, a, b] = PALETTES[(base + variant * 3) % PALETTES.length];
  const template = TEMPLATES[(base + variant * 5) % TEMPLATES.length];
  const rotation = ((h >>> 15) % 4) * 90;
  const shapes = template({ bg, a, b, paper: PAPER }, makeRand(h));

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden
      className={className}
      style={{ borderRadius: "50%", display: "block" }}
    >
      <rect width={64} height={64} fill={bg} />
      <g transform={`rotate(${rotation} 32 32)`}>{shapes}</g>
    </svg>
  );
}
