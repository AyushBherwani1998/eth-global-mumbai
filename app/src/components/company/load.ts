"use client";

// Mock read state (UX.md section 3 shared rules): a short delay so the skeleton
// is real, then data. `?mock=error` makes the first read fail, so the
// private-read error card and its "Try again" are reachable without a chain.

import { useCallback, useEffect, useState } from "react";

export type LoadState = { loading: boolean; error: boolean; retry: () => void; retrying: boolean };

export function useMockLoad(delayMs = 300): LoadState {
  const [done, setDone] = useState<{ attempt: number; error: boolean }>({ attempt: -1, error: false });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const id = setTimeout(() => {
      const fails = attempt === 0 && window.location.search.includes("mock=error");
      setDone({ attempt, error: fails });
    }, delayMs);
    return () => clearTimeout(id);
  }, [delayMs, attempt]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  const loading = done.attempt !== attempt;
  return { loading, error: !loading && done.error, retry, retrying: loading && attempt > 0 };
}
