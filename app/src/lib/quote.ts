// Debounced, latest-only server quotes. The swap form asks services/api for a
// prepared swap as the user types; only the newest request may reach the
// screen, so a slow answer for "1" can never overwrite the answer for "10".
//
// No runtime imports: tested under `node --test` with fake timers.

export type QuoteState<T> =
  | { status: "idle"; key: null }
  | { status: "loading"; key: string }
  | { status: "ready"; key: string; value: T }
  | { status: "error"; key: string; error: unknown };

type Timers = {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
};

export function createQuoter<T>(opts: {
  fetch: (key: string) => Promise<T>;
  onChange: (state: QuoteState<T>) => void;
  delayMs?: number;
  timers?: Timers;
}) {
  const delay = opts.delayMs ?? 400;
  const timers: Timers = opts.timers ?? {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
  };
  let seq = 0;
  let pending: unknown = null;
  let current: string | null = null;

  const cancel = () => {
    if (pending !== null) timers.clearTimeout(pending);
    pending = null;
  };

  return {
    /** Ask for `key` (null clears). Same key as the current one is a no-op unless `force`. */
    request(key: string | null, force = false) {
      if (!force && key === current) return;
      current = key;
      cancel();
      const mine = ++seq;
      if (key === null) {
        opts.onChange({ status: "idle", key: null });
        return;
      }
      opts.onChange({ status: "loading", key });
      pending = timers.setTimeout(() => {
        pending = null;
        opts.fetch(key).then(
          (value) => {
            if (mine === seq) opts.onChange({ status: "ready", key, value });
          },
          (error) => {
            if (mine === seq) opts.onChange({ status: "error", key, error });
          },
        );
      }, delay);
    },
    /** Drop anything in flight; later answers are ignored. */
    dispose() {
      cancel();
      seq += 1;
      current = null;
    },
  };
}
