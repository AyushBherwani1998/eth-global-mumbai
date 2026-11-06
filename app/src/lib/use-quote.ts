"use client";

// React face of lib/quote.ts: a debounced, latest-only server quote keyed by
// what the user typed. While the key is changing (or the first answer for a
// key is in flight) the state is "loading"; an answer for an older key is
// dropped. A ready quote is refreshed in the background every `refreshMs`, and
// keeps showing until the fresh one lands.

import { useEffect, useRef, useState } from "react";
import { createQuoter, type QuoteState } from "./quote";

export function useQuote<T>(key: string | null, fetch: (key: string) => Promise<T>, opts: { delayMs?: number; refreshMs?: number } = {}): QuoteState<T> {
  const fetchRef = useRef(fetch);
  useEffect(() => {
    fetchRef.current = fetch;
  });
  const [settled, setSettled] = useState<QuoteState<T>>({ status: "idle", key: null });
  const delayMs = opts.delayMs ?? 400;
  const refreshMs = opts.refreshMs ?? 15_000;

  // One quoter per key: a new key disposes the old one, which cancels its
  // pending timer and drops any answer still in flight.
  useEffect(() => {
    if (key === null) return;
    const quoter = createQuoter<T>({
      fetch: (k) => fetchRef.current(k),
      onChange: (s) => {
        if (s.status === "ready" || s.status === "error") setSettled(s);
      },
      delayMs,
    });
    quoter.request(key);
    const id = setInterval(() => {
      if (typeof document === "undefined" || !document.hidden) quoter.request(key, true);
    }, refreshMs);
    return () => {
      clearInterval(id);
      quoter.dispose();
    };
  }, [key, delayMs, refreshMs]);

  if (key === null) return { status: "idle", key: null };
  return settled.key === key ? settled : { status: "loading", key };
}
