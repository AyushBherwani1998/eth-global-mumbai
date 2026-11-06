// Flat company marks. One colour per ticker, square, no gradient, no shadow.
// Green and red stay reserved for prices, so none of these are the gain or loss hues.

export const LOGO_COLOR: Record<string, string> = {
  acme: "#1C4E89",
  kesar: "#C46B2C",
  tara: "#7A3E5C",
  masala: "#A15C1A",
  nirmaan: "#3E4C6B",
  vayu: "#1F6A6A",
  lotus: "#8E3D55",
  prakriti: "#3E6B4F",
};

const GLYPH: Record<string, string> = {
  acme: "M16 5.5 26.5 26h-4.2l-1.7-4.4H11.4L9.7 26H5.5L16 5.5zm0 7.2-2.7 6.7h5.4L16 12.7z",
  kesar: "M16 4.5 27.5 16 16 27.5 4.5 16 16 4.5z",
  tara: "M6 8h20v3.2H6V8zm0 6.4h20v3.2H6v-3.2zm0 6.4h20V24H6v-3.2z",
  masala: "M16 6.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19zm0 3.2a6.3 6.3 0 1 1 0 12.6 6.3 6.3 0 0 1 0-12.6z",
  nirmaan: "M7 26V12.5L16 6l9 6.5V26H7zm5.2-3.2h3.2v-4.2h-3.2v4.2zm4.6 0h3.2V14.2h-3.2v8.6z",
  vayu: "M16 5.5 27 18.2h-6.2V26h-9.6v-7.8H5L16 5.5z",
  lotus: "M16 26c0-6 3.2-10.2 3.2-10.2S16 12 16 6c0 6-3.2 9.8-3.2 9.8S16 20 16 26zm-7.2-3.2c3.4-2.2 6-1.2 7.2.4-2.6-4.6-1.2-8.2.2-10.2-4.2 2.4-8.6 1.6-10.6-.6 2 4.8 1.4 8.2 3.2 10.4zm14.4 0c-3.4-2.2-6-1.2-7.2.4 2.6-4.6 1.2-8.2-.2-10.2 4.2 2.4 8.6 1.6 10.6-.6-2 4.8-1.4 8.2-3.2 10.4z",
  prakriti:
    "M16 4.5c5.6 6.2 9 11.2 9 15.4a9 9 0 0 1-18 0c0-4.2 3.4-9.2 9-15.4zm0 8.4c1 0 1.7 3.1 1.7 6.8s-.7 6.8-1.7 6.8-1.7-3.1-1.7-6.8.7-6.8 1.7-6.8z",
};

export function logoColor(ticker: string): string {
  return LOGO_COLOR[ticker] ?? "#3E4C6B";
}

export function CompanyLogo({ ticker, size = 40, className }: { ticker: string; size?: number; className?: string }) {
  const color = logoColor(ticker);
  const d = GLYPH[ticker];
  const radius = Math.min(10, Math.round(size * 0.22));
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden
      className={className}
      style={{ borderRadius: radius, display: "block", flexShrink: 0, overflow: "hidden" }}
    >
      <rect width="32" height="32" fill={color} />
      {d ? (
        <path d={d} fill="#fff" fillRule="evenodd" />
      ) : (
        <text x="16" y="21" textAnchor="middle" fill="#fff" fontSize="12" fontFamily="Roboto, sans-serif">
          {ticker.slice(0, 2).toUpperCase()}
        </text>
      )}
    </svg>
  );
}
