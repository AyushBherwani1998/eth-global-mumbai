import { test } from "node:test";
import assert from "node:assert/strict";

import { currentStep, lifecycle, nextByPhase } from "./lifecycle.ts";
import type { Listing } from "@/lib/api";

const records = (auction: string | null) => ({ addr: null, token: null, auction, hook: null, policy: null, pool: null }) as Listing["records"];

test("a live auction with a resolved name and a landed report is waiting on the sale", () => {
  const done = lifecycle({ phase: "live", records: records("0xa") }, { ensResolved: true, policyVersion: 2 });
  assert.deepEqual(done, { create: true, ticker: true, policy: true, launch: true, monitor: false, graduate: false });
  assert.equal(currentStep(done), "monitor");
});

test("unknown reads count as not done, so nothing is claimed early", () => {
  const done = lifecycle({ phase: "listed", records: records("0xa") }, { ensResolved: null, policyVersion: null });
  assert.equal(done.ticker, false);
  assert.equal(done.policy, false);
  assert.equal(currentStep(done), "ticker");
});

test("a draft with no auction has not launched; a listed one is done", () => {
  assert.equal(lifecycle({ phase: "draft", records: records(null) }, { ensResolved: true, policyVersion: 1 }).launch, false);
  const listed = lifecycle({ phase: "listed", records: records("0xa") }, { ensResolved: true, policyVersion: 5 });
  assert.equal(currentStep(listed), null);
});

test("a refunding auction is over but never lists", () => {
  const done = lifecycle({ phase: "refunding", records: records("0xa") }, { ensResolved: true, policyVersion: 0 });
  assert.equal(done.monitor, true);
  assert.equal(done.graduate, false);
  assert.equal(done.policy, false, "version 0 means no report has landed");
  assert.equal(nextByPhase("refunding"), "Refunds are open");
});
