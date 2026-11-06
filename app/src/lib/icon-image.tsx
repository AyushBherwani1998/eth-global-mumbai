import { ImageResponse } from "next/og";

const BRAND = "#5367FF";

/** App icon (PNG) for the manifest, favicon and Apple touch icon. Flat brand mark, no gradient. */
export function iconImage(size: number, { maskable = false } = {}) {
  const pad = maskable ? size * 0.18 : size * 0.1;
  const inner = size - pad * 2;
  return new ImageResponse(
    (
      <div
        style={{
          width: size,
          height: size,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: maskable ? BRAND : "transparent",
        }}
      >
        <div
          style={{
            width: inner,
            height: inner,
            borderRadius: maskable ? 0 : inner,
            background: BRAND,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg width={inner * 0.62} height={inner * 0.62} viewBox="0 0 20 16">
            <path d="M1 13 L7 6.5 L11 10 L19 1.5" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M14.5 1.5 H19 V6" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
    ),
    { width: size, height: size },
  );
}
