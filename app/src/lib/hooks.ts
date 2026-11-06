"use client";

import { useEffect, useState } from "react";
import { BLOCK_SECONDS } from "./format";

type Tick = { src: number | null; left: number };

/**
 * Seconds left, ticking down once a second from whatever the backend last
 * said. Pass null when there is no deadline (nothing scheduled, or the phase
 * has no next boundary) and this returns null, so the screen can say so
 * instead of showing a zero.
 *
 * The tick is only written from the timer, and a fresh `seconds` from the next
 * poll wins until the first tick after it, so nothing is set during render or
 * from an effect body.
 */
export function useCountdown(seconds: number | null): number | null {
  const [tick, setTick] = useState<Tick>({ src: null, left: 0 });

  useEffect(() => {
    if (seconds === null) return;
    const started = Date.now();
    const id = setInterval(() => setTick({ src: seconds, left: Math.max(0, seconds - (Date.now() - started) / 1000) }), 1000);
    return () => clearInterval(id);
  }, [seconds]);

  if (seconds === null) return null;
  return tick.src === seconds ? tick.left : seconds;
}

/** Blocks until a boundary, as seconds. Null stays null. */
export function blocksAsSeconds(blocks: number | null | undefined): number | null {
  return blocks === null || blocks === undefined ? null : Math.max(0, blocks) * BLOCK_SECONDS;
}
