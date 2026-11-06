"use client";

import { useEffect, useState } from "react";
import { BLOCK_SECONDS } from "./format";
import { CURRENT_BLOCK } from "./mock";

/** Seconds remaining until `targetBlock`, ticking down live from the mock "now". */
export function useBlockCountdown(targetBlock: number | undefined) {
  const initial = targetBlock ? Math.max(0, (targetBlock - CURRENT_BLOCK) * BLOCK_SECONDS) : 0;
  const [left, setLeft] = useState(initial);
  useEffect(() => {
    if (!initial) return;
    const started = Date.now();
    const id = setInterval(() => setLeft(Math.max(0, initial - (Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, [initial]);
  return { seconds: left, block: CURRENT_BLOCK + Math.floor((initial - left) / BLOCK_SECONDS) };
}
