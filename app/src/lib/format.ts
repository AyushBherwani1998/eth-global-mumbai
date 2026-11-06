// Shared formatters. Prices are USDC per 1,000-share lot everywhere in the UI;
// the per-share value (lot / 1000) is secondary text to 5 decimals.

export const LOT = 1000;
export const BLOCK_SECONDS = 12;

export function lot(p: number, digits = 2): string {
  return p.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, 4) });
}

export function lotFixed(p: number, digits = 2): string {
  return p.toFixed(digits);
}

export function perShare(p: number): string {
  return (p / LOT).toFixed(5);
}

export function usdc(n: number, digits = 2): string {
  return n.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function shares(n: number): string {
  return Math.round(n).toLocaleString("en-IN");
}

export function signed(n: number, digits = 2): string {
  // Round before the sign, so a sub-cent fall prints "0.00" and not "-0.00".
  const rounded = Number(n.toFixed(digits));
  const s = Math.abs(rounded).toFixed(digits);
  return rounded > 0 ? `+${s}` : rounded < 0 ? `-${s}` : s;
}

export function pct(n: number, digits = 2): string {
  return `${signed(n, digits)}%`;
}

export function changeVs(price: number, base: number) {
  const abs = price - base;
  const rel = (abs / base) * 100;
  return { abs, rel, up: abs >= 0 };
}

export function shortAddr(a: string | null | undefined): string {
  if (!a) return "—";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function shortHash(h: string): string {
  return `${h.slice(0, 6)}…${h.slice(-4)}`;
}

const istTime = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const istDate = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });

export function toDate(t: string | number): Date {
  return typeof t === "number" ? new Date(t * 1000) : new Date(t);
}

export function timeIST(t: string | number): string {
  return `${istTime.format(toDate(t))} IST`;
}

export function dateTimeIST(t: string | number): string {
  return `${istDate.format(toDate(t))}, ${istTime.format(toDate(t))} IST`;
}

export function dateIST(t: string | number): string {
  return istDate.format(toDate(t));
}

export function blocksToDuration(blocks: number): string {
  const s = Math.max(0, blocks) * BLOCK_SECONDS;
  return secondsToDuration(s);
}

/** Plain-English countdown for copy: "6h 4m", "17 min", "under a minute". */
export function countdown(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m} min`;
  return "under a minute";
}

export function blocksToCountdown(blocks: number): string {
  return countdown(Math.max(0, blocks) * BLOCK_SECONDS);
}

export function secondsToDuration(total: number): string {
  const s = Math.max(0, Math.round(total));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export function blockNo(b: number): string {
  return b.toLocaleString("en-US");
}

export const ETHERSCAN = "https://sepolia.etherscan.io";
export const txUrl = (h: string) => `${ETHERSCAN}/tx/${h}`;
export const addrUrl = (a: string) => `${ETHERSCAN}/address/${a}`;
