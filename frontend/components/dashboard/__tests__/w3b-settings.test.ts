/*
 * W3b: Settings integer inputs (latency 0–10000 ms, overtrading threshold 1–100) are validated on the client
 * so the page never sends NaN / out-of-range values (the backend answers 400/422 for those).
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { parseIntSetting } from "@/components/dashboard/settings/system";

describe("parseIntSetting", () => {
  test("accepts integers inside the range (trimmed)", () => {
    assert.deepEqual(parseIntSetting(" 250 ", 0, 10_000, "Latency"), { value: 250, error: null });
    assert.deepEqual(parseIntSetting("0", 0, 10_000, "Latency"), { value: 0, error: null });
    assert.deepEqual(parseIntSetting("10000", 0, 10_000, "Latency"), { value: 10_000, error: null });
    assert.deepEqual(parseIntSetting("1", 1, 100, "Overtrading праг"), { value: 1, error: null });
  });

  test("rejects empty, non-numeric, decimal and exponent input", () => {
    for (const raw of ["", "  ", "abc", "12.5", "1e3", "Infinity", "NaN", "5 ms", "0x10"]) {
      const r = parseIntSetting(raw, 0, 10_000, "Latency");
      assert.equal(r.value, null, raw);
      assert.match(r.error ?? "", /^Latency: въведи цяло число между 0 и 10000\.$/, raw);
    }
  });

  test("rejects values outside the backend range", () => {
    for (const raw of ["-1", "10001", "99999999999999999999"]) {
      const r = parseIntSetting(raw, 0, 10_000, "Latency");
      assert.equal(r.value, null, raw);
      assert.equal(r.error, "Latency: допустимо е от 0 до 10000.", raw);
    }
    assert.equal(parseIntSetting("0", 1, 100, "Overtrading праг").error, "Overtrading праг: допустимо е от 1 до 100.");
    assert.equal(parseIntSetting("101", 1, 100, "Overtrading праг").error, "Overtrading праг: допустимо е от 1 до 100.");
  });
});
