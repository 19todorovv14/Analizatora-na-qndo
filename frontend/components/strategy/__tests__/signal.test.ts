/* Unit tests for the evaluated-signal helpers ("Check current signal", bot last signal) in components/strategy/signal.ts. */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { BLOCK_TITLE, activeBlocks, conditionPass, conditionValueText, passedCount, signalTone } from "../signal";
import type { BlockResult, SignalResponse } from "../types";

describe("signal badge", () => {
  test("tone per signal", () => {
    assert.equal(signalTone("LONG SETUP"), "up");
    assert.equal(signalTone("SHORT SETUP"), "down");
    assert.equal(signalTone("NO TRADE"), "neutral");
    assert.equal(signalTone("WAIT"), "info");
    assert.equal(signalTone("long setup"), "up");
    assert.equal(signalTone(null), "neutral");
    assert.equal(signalTone(""), "neutral");
  });

  test("walkthrough anchor: the LONG block is titled 'LONG setup'", () => {
    assert.equal(BLOCK_TITLE.entry_long, "LONG setup");
    assert.equal(BLOCK_TITLE.entry_short, "SHORT setup");
  });
});

describe("evaluation", () => {
  const block = (active: boolean, passed = false): BlockResult => ({ active, passed, conditions: [], logic: "all" });

  test("active blocks in a fixed order (entries first), inactive ones skipped", () => {
    const ev: SignalResponse["evaluation"] = { exit_short: block(true), entry_short: block(true), entry_long: block(true, true), exit_long: block(false) };
    assert.deepEqual(
      activeBlocks(ev).map(([k]) => k),
      ["entry_long", "entry_short", "exit_short"],
    );
    assert.deepEqual(activeBlocks({}), []);
    assert.deepEqual(activeBlocks(null), []);
  });

  test("value text: comparison, boolean (structure / candle pattern) and warm-up", () => {
    assert.equal(conditionValueText({ left: 106735.2, right: 104665.9 }), "106,735 vs 104,666");
    assert.equal(conditionValueText({ left: 60.6712, right: 50 }), "60.67 vs 50");
    assert.equal(conditionValueText({ left: 1, right: null }), "стойност: да (1)");
    assert.equal(conditionValueText({ left: 0, right: null }), "стойност: не (0)");
    assert.match(conditionValueText({ left: null, right: 50 }), /warm-up/);
  });

  test("a condition without a value yet is neither pass nor fail", () => {
    assert.equal(conditionPass({ left: null, passed: false }), null);
    assert.equal(conditionPass({ left: 0, passed: false }), false);
    assert.equal(conditionPass({ left: 1, passed: true }), true);
  });

  test("passed counter", () => {
    assert.deepEqual(passedCount([{ passed: true }, { passed: false }, { passed: true }]), { passed: 2, total: 3 });
    assert.deepEqual(passedCount([]), { passed: 0, total: 0 });
  });
});
