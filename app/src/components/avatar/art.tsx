// Generated profile picture: a flat monochrome mark on a 64-unit grid, picked
// deterministically from the wallet address. No library, no network, no canvas.
//
// Why monochrome. The company marks (components/company/logos.tsx) are a
// saturated field carrying a white glyph in a rounded square, and they own the
// --mark-* hues. An avatar built from the same hues reads as one more company
// logo. So a person's picture is built only from the ink of the interface:
// var(--text) laid over var(--surface) at fixed strengths. Nothing in the app
// that is not a person is grey, so a person is never mistaken for a company,
// and the picture follows light and dark without a second palette.
//
// Why full-bleed. A small shape centred in a field is the grammar of an icon:
// a triangle becomes play, two bars become pause, a dot in a ring becomes
// record. Every direction here divides the whole circle instead, so the mark
// is read as a mark and not as a control.
//
// Three directions are implemented. DIRECTION picks the one the app ships; the
// other two stay here, one word away.
//
//   field   flat value fields divided by a straight edge
//   moon    the same, divided by the edge of one large circle
//   rule    hairlines and arcs crossing the frame, nothing contained
//
// Rules that hold in all three: the same address and variant always give the
// same picture; every tone is ink over surface at 0.09 or more, so no field
// can match the frame and look like a bite out of the circle; the smallest
// feature is 5 units (just under 2px at 24px) so every mark survives the app
// bar; tones top out well short of full ink, so an avatar never outshouts the
// hairlines and black text around it.

import { Fragment, type ReactNode } from "react";

const INK = "var(--text)";
const PAPER = "var(--surface)";

/**
 * Opacities, not colours. `ground` tints the whole circle; `soft` and `firm`
 * are laid over it, so a nested shape reads darker than a neighbouring one
 * without either needing its own colour.
 */
type Tones = { ground: number; soft: number; firm: number };
type Layer = { a: number; nodes: ReactNode[] };
type Form = { spin?: boolean; tilt?: number; draw: (t: Tones) => Layer[] };
type Direction = { forms: Form[]; tones: Tones[] };

const L = (a: number, ...nodes: ReactNode[]): Layer => ({ a, nodes });

/** Strokes run past the frame so a cap is never visible inside the circle. */
const OUT = 14;
const LINE = { fill: "none", strokeWidth: 7.5 } as const;

// --- deterministic hashing ---------------------------------------------------

function hash32(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// --- 1. field: straight edges ------------------------------------------------
// Two or three flat values meeting on a straight edge. Nothing here is small
// enough to break down at 24px, and the silhouette is the frame itself.

const FIELD: Direction = {
  tones: [
    { ground: 0.16, soft: 0.24, firm: 0.52 },
    { ground: 0.22, soft: 0.26, firm: 0.58 },
    { ground: 0.17, soft: 0.2, firm: 0.47 },
  ],
  forms: [
    // half
    { spin: true, draw: (t) => [L(t.firm, <rect x={0} y={34} width={64} height={30} />)] },
    // two bands under a wide ground
    {
      spin: true,
      draw: (t) => [L(t.soft, <rect x={0} y={22} width={64} height={20} />), L(t.firm, <rect x={0} y={42} width={64} height={22} />)],
    },
    // off-centre split
    { spin: true, draw: (t) => [L(t.firm, <rect x={26} y={0} width={38} height={64} />)] },
    // diagonal
    { spin: true, draw: (t) => [L(t.firm, <path d="M0,64 L64,0 L64,64 Z" />)] },
    // opposite quarters
    {
      spin: true,
      draw: (t) => [L(t.firm, <rect x={32} y={0} width={32} height={32} />), L(t.soft, <rect x={0} y={32} width={32} height={32} />)],
    },
    // band
    { spin: true, draw: (t) => [L(t.firm, <rect x={0} y={23} width={64} height={18} />)] },
    // cut corner
    { spin: true, draw: (t) => [L(t.soft, <path d="M0,0 L64,0 L0,42 Z" />)] },
    // column and shelf
    {
      spin: true,
      draw: (t) => [L(t.firm, <rect x={0} y={0} width={24} height={64} />), L(t.soft, <rect x={24} y={44} width={40} height={20} />)],
    },
    // diagonal band
    { spin: true, draw: (t) => [L(t.firm, <path d="M0,44 L44,0 L64,0 L64,20 L20,64 L0,64 Z" />)] },
    // step
    {
      spin: true,
      draw: (t) => [L(t.firm, <rect x={0} y={32} width={64} height={32} />), L(t.soft, <rect x={32} y={16} width={32} height={16} />)],
    },
    // three columns
    {
      spin: true,
      draw: (t) => [L(t.soft, <rect x={21} y={0} width={22} height={64} />), L(t.firm, <rect x={43} y={0} width={21} height={64} />)],
    },
    // shelf over a half
    {
      spin: true,
      draw: (t) => [L(t.firm, <rect x={0} y={38} width={64} height={26} />), L(t.soft, <rect x={0} y={26} width={64} height={12} />)],
    },
  ],
};

// --- 2. moon: curved edges ---------------------------------------------------
// The same restraint with one large circle instead of a straight edge. Every
// circle is bigger than the frame or centred outside it, so what shows is an
// arc crossing the picture, never a disc sitting inside it.

const MOON: Direction = {
  tones: [
    { ground: 0.16, soft: 0.22, firm: 0.5 },
    { ground: 0.21, soft: 0.25, firm: 0.56 },
    { ground: 0.18, soft: 0.2, firm: 0.46 },
  ],
  forms: [
    // crescent, light side left
    { spin: true, draw: (t) => [L(t.firm, <circle cx={46} cy={32} r={30} />)] },
    // wide crescent
    { spin: true, draw: (t) => [L(t.firm, <circle cx={-2} cy={32} r={40} />)] },
    // dome with a nested dome
    {
      spin: true,
      draw: (t) => [L(t.soft, <circle cx={32} cy={62} r={44} />), L(t.firm, <circle cx={32} cy={70} r={34} />)],
    },
    // two circles meeting: the overlap reads as a third value
    {
      spin: true,
      draw: (t) => [L(t.soft, <circle cx={32} cy={6} r={30} />), L(t.soft, <circle cx={32} cy={58} r={30} />)],
    },
    // corner bloom
    { spin: true, draw: (t) => [L(t.soft, <circle cx={8} cy={8} r={40} />), L(t.firm, <circle cx={4} cy={4} r={24} />)] },
    // ring of ground around a near-full disc
    { draw: (t) => [L(t.firm, <circle cx={32} cy={32} r={27} />)] },
    // shallow rise
    { spin: true, draw: (t) => [L(t.firm, <circle cx={32} cy={84} r={56} />)] },
    // opposed blooms
    { spin: true, draw: (t) => [L(t.soft, <circle cx={58} cy={6} r={36} />), L(t.soft, <circle cx={6} cy={58} r={36} />)] },
    // crescent over a half
    {
      spin: true,
      draw: (t) => [L(t.soft, <rect x={0} y={30} width={64} height={34} />), L(t.firm, <circle cx={40} cy={40} r={30} />)],
    },
    // eclipse: a large arc with a smaller one inside it
    {
      spin: true,
      draw: (t) => [L(t.soft, <circle cx={-6} cy={32} r={46} />), L(t.firm, <circle cx={-18} cy={32} r={44} />)],
    },
    // quarter bloom with a straight edge
    {
      spin: true,
      draw: (t) => [L(t.firm, <circle cx={60} cy={58} r={42} />), L(t.soft, <rect x={0} y={0} width={64} height={14} />)],
    },
    // two arcs from the same side
    {
      spin: true,
      draw: (t) => [L(t.soft, <circle cx={32} cy={-14} r={40} />), L(t.firm, <circle cx={32} cy={-26} r={40} />)],
    },
  ],
};

// --- 3. rule: hairlines and arcs ---------------------------------------------
// The lightest of the three. One stroke weight, every line running out past
// the frame, so the picture is a fragment of a larger drawing rather than a
// glyph. Matches an interface made of 1px rules and white space.

const RULE: Direction = {
  tones: [
    { ground: 0.13, soft: 0.2, firm: 0.54 },
    { ground: 0.17, soft: 0.22, firm: 0.6 },
    { ground: 0.11, soft: 0.17, firm: 0.48 },
  ],
  forms: [
    // one arc sweeping through
    { spin: true, draw: (t) => [L(t.firm, <circle cx={58} cy={32} r={34} {...LINE} />)] },
    // arc and a rule
    {
      spin: true,
      draw: (t) => [
        L(t.firm, <circle cx={4} cy={4} r={30} {...LINE} />, <path d={`M${-OUT},46 H${64 + OUT}`} {...LINE} />),
      ],
    },
    // two rules
    {
      spin: true,
      draw: (t) => [L(t.firm, <path d={`M${-OUT},22 H${64 + OUT}`} {...LINE} />, <path d={`M${-OUT},42 H${64 + OUT}`} {...LINE} />)],
    },
    // shallow arc under a rule
    {
      spin: true,
      draw: (t) => [L(t.firm, <circle cx={32} cy={66} r={40} {...LINE} />, <path d={`M${-OUT},16 H${64 + OUT}`} {...LINE} />)],
    },
    // inner ring
    { draw: (t) => [L(t.firm, <circle cx={32} cy={32} r={24} {...LINE} />)] },
    // three rules
    {
      spin: true,
      draw: (t) => [
        L(t.firm,
          <path d={`M${-OUT},14 H${64 + OUT}`} {...LINE} />,
          <path d={`M${-OUT},32 H${64 + OUT}`} {...LINE} />,
          <path d={`M${-OUT},50 H${64 + OUT}`} {...LINE} />,
        ),
      ],
    },
    // rule across a corner, with an arc
    {
      spin: true,
      tilt: 45,
      draw: (t) => [L(t.firm, <path d={`M${-OUT},32 H${64 + OUT}`} {...LINE} />, <circle cx={50} cy={14} r={22} {...LINE} />)],
    },
    // two concentric arcs from a corner
    {
      spin: true,
      draw: (t) => [L(t.firm, <circle cx={10} cy={54} r={16} {...LINE} />, <circle cx={10} cy={54} r={30} {...LINE} />)],
    },
    // a rule on the edge of a soft field
    {
      spin: true,
      draw: (t) => [L(t.soft, <rect x={0} y={36} width={64} height={28} />), L(t.firm, <path d={`M${-OUT},36 H${64 + OUT}`} {...LINE} />)],
    },
    // a rule and a very shallow arc running with it
    {
      spin: true,
      draw: (t) => [L(t.firm, <path d={`M${-OUT},22 H${64 + OUT}`} {...LINE} />, <circle cx={32} cy={118} r={76} {...LINE} />)],
    },
    // two arcs sweeping from the same side
    {
      spin: true,
      draw: (t) => [L(t.firm, <circle cx={-24} cy={32} r={40} {...LINE} />, <circle cx={-24} cy={32} r={58} {...LINE} />)],
    },
    // arc over a soft corner
    {
      spin: true,
      draw: (t) => [L(t.soft, <path d="M0,0 L64,0 L0,46 Z" />), L(t.firm, <circle cx={62} cy={62} r={40} {...LINE} />)],
    },
  ],
};

export const DIRECTIONS = { field: FIELD, moon: MOON, rule: RULE };
export type DirectionName = keyof typeof DIRECTIONS;

/** The direction the app ships. The other two render from the same file. */
export const DIRECTION: DirectionName = "field";

/** How many different pictures the picker offers for one address. */
export const VARIANT_COUNT = 8;

// --- component ---------------------------------------------------------------

export function GeneratedAvatar({
  address,
  variant = 0,
  size = 36,
  className,
  direction = DIRECTION,
}: {
  address: string;
  variant?: number;
  size?: number;
  className?: string;
  direction?: DirectionName;
}) {
  // The address picks where the walk starts; the variant steps along by strides
  // coprime with the list lengths, so the eight pictures the picker offers are
  // eight different forms rather than the same one restated.
  const key = address.toLowerCase();
  const base = hash32(key);
  const h = hash32(`${key}#${variant}`);
  const d = DIRECTIONS[direction];
  const tones = d.tones[(base + variant * 3) % d.tones.length];
  const form = d.forms[(base + variant * 5) % d.forms.length];
  const turn = (form.spin ? ((h >>> 13) % 4) * 90 : 0) + (form.tilt ?? 0);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden
      className={className}
      style={{ borderRadius: "50%", display: "block" }}
    >
      <rect width={64} height={64} fill={PAPER} />
      <rect width={64} height={64} fill={INK} opacity={tones.ground} />
      <g transform={`rotate(${turn} 32 32)`}>
        {form.draw(tones).map((layer, i) => (
          <g key={i} fill={INK} stroke={INK} strokeWidth={0} opacity={layer.a}>
            {layer.nodes.map((node, j) => (
              <Fragment key={j}>{node}</Fragment>
            ))}
          </g>
        ))}
      </g>
    </svg>
  );
}
