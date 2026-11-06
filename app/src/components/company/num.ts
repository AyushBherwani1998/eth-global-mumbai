// Small number helpers shared by the Markets and company screens.

/** "2h 15m", "17m 29s", "42s": a countdown that reads as words, not a clock time. */
export function countdown(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

/**
 * Prices here sit near 1.00 and move in thousandths, so a two-decimal change
 * prints "-0.00". Show three decimals when the move is that small.
 */
export function changeDigits(abs: number): number {
  return Math.abs(abs) < 0.01 ? 3 : 2;
}
