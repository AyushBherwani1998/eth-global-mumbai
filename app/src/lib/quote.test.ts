import { test } from "node:test";
import assert from "node:assert/strict";
import { createQuoter, type QuoteState } from "./quote.ts";

function fakeTimers() {
  let id = 0;
  const due = new Map<number, () => void>();
  return {
    timers: {
      setTimeout: (fn: () => void) => {
        id += 1;
        due.set(id, fn);
        return id;
      },
      clearTimeout: (h: unknown) => {
        due.delete(h as number);
      },
    },
    flush() {
      const fns = [...due.values()];
      due.clear();
      for (const f of fns) f();
    },
    get pending() {
      return due.size;
    },
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((r) => setImmediate(r));

test("debounce: rapid typing fetches only the last amount", async () => {
  const t = fakeTimers();
  const fetched: string[] = [];
  const states: QuoteState<string>[] = [];
  const q = createQuoter<string>({ fetch: async (k) => (fetched.push(k), `quote ${k}`), onChange: (s) => states.push(s), timers: t.timers });
  q.request("1");
  q.request("10");
  q.request("100");
  assert.equal(t.pending, 1);
  t.flush();
  await tick();
  assert.deepEqual(fetched, ["100"]);
  assert.deepEqual(states.at(-1), { status: "ready", key: "100", value: "quote 100" });
});

test("stale answer: a slow quote for an older amount never wins", async () => {
  const t = fakeTimers();
  const slow = deferred<string>();
  const fast = deferred<string>();
  const states: QuoteState<string>[] = [];
  const q = createQuoter<string>({ fetch: (k) => (k === "1" ? slow.promise : fast.promise), onChange: (s) => states.push(s), timers: t.timers });

  q.request("1");
  t.flush(); // "1" is in flight
  q.request("10");
  t.flush(); // "10" is in flight
  fast.resolve("quote 10");
  await tick();
  slow.resolve("quote 1"); // arrives last
  await tick();

  const ready = states.filter((s) => s.status === "ready");
  assert.deepEqual(ready, [{ status: "ready", key: "10", value: "quote 10" }]);
  assert.deepEqual(states.at(-1), { status: "ready", key: "10", value: "quote 10" });
});

test("errors are latest-only too, and clearing drops everything", async () => {
  const t = fakeTimers();
  const d = deferred<string>();
  const states: QuoteState<string>[] = [];
  const q = createQuoter<string>({ fetch: () => d.promise, onChange: (s) => states.push(s), timers: t.timers });
  q.request("5");
  t.flush();
  q.request(null);
  d.reject(new Error("late"));
  await tick();
  assert.deepEqual(states.at(-1), { status: "idle", key: null });
});

test("same key is a no-op unless forced (refresh)", async () => {
  const t = fakeTimers();
  let n = 0;
  const q = createQuoter<number>({ fetch: async () => ++n, onChange: () => {}, timers: t.timers });
  q.request("5");
  t.flush();
  q.request("5");
  assert.equal(t.pending, 0);
  q.request("5", true);
  assert.equal(t.pending, 1);
});

test("dispose ignores answers already in flight", async () => {
  const t = fakeTimers();
  const d = deferred<string>();
  const states: QuoteState<string>[] = [];
  const q = createQuoter<string>({ fetch: () => d.promise, onChange: (s) => states.push(s), timers: t.timers });
  q.request("5");
  t.flush();
  q.dispose();
  d.resolve("late");
  await tick();
  assert.equal(states.filter((s) => s.status === "ready").length, 0);
});
