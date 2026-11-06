import { ImageResponse } from "next/og";

// The thaamba mark on an Ink tile (design/brand/TOKENS.md). The octagon is the
// same geometry the <Mark> component draws, written out here because the PNG is
// rendered by Satori and cannot read a CSS variable: Ink ground, Paper outline.
const INK = "#0E0E10";
const PAPER = "#EDEDEB";

const OCTAGON =
  "M34.7273 6.29842C37.7433 4.84597 41.2567 4.84596 44.2727 6.29842L62.4823 15.0677C65.4984 16.5201 67.6889 19.267 68.4338 22.5306L72.9312 42.235C73.6761 45.4986 72.8943 48.9239 70.8071 51.5411L58.2057 67.3428C56.1185 69.96 52.9531 71.4844 49.6056 71.4844H29.3945C26.0469 71.4844 22.8815 69.96 20.7943 67.3428L8.19289 51.5411C6.10571 48.9239 5.32392 45.4986 6.06882 42.235L10.5662 22.5306C11.3111 19.267 13.5016 16.5201 16.5177 15.0677L34.7273 6.29842Z";

// Tight box around the stroked octagon: x 1.3..77.7, y 0.8..75.5.
const VB_W = 79;
const VB_H = 76.4;

/** App icon (PNG) for the manifest, favicon and Apple touch icon. Flat, no gradient. */
export function iconImage(size: number, { maskable = false } = {}) {
  const pad = maskable ? size * 0.18 : size * 0.1;
  const inner = size - pad * 2;
  // Maskable art must survive a circular crop, so the octagon fills more of the
  // already-padded tile; the plain tile keeps a visible Ink border.
  const glyph = inner * (maskable ? 0.8 : 0.6);
  return new ImageResponse(
    (
      <div
        style={{
          width: size,
          height: size,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: maskable ? INK : "transparent",
        }}
      >
        <div
          style={{
            width: inner,
            height: inner,
            borderRadius: maskable ? 0 : inner * 0.22,
            background: INK,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg width={glyph} height={(glyph * VB_H) / VB_W} viewBox={`0 0 ${VB_W} ${VB_H}`}>
            <path d={OCTAGON} fill="none" stroke={PAPER} strokeWidth="8" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
        </div>
      </div>
    ),
    { width: size, height: size },
  );
}
