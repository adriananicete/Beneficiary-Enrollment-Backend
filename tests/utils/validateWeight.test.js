import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { validateWeight } from "../../src/utils/validateWeight.js";

describe("validateWeight", () => {
  test("accepts ordinary weights in kilogrammes", () => {
    for (const weight of [25, 54.2, 72.5, 300, "68.4"]) {
      assert.equal(validateWeight(weight), null, `weight=${weight}`);
    }
  });

  test("refuses a typo or an absurd value", () => {
    assert.match(validateWeight(7), /between 25 and 300/);
    assert.match(validateWeight(999.99), /between 25 and 300/);
    assert.match(validateWeight(-5), /between 25 and 300/);
  });

  test("refuses a value that is not a number", () => {
    assert.match(validateWeight("abc"), /must be a number/);
    assert.match(validateWeight(undefined), /must be a number/);
  });

  test("ACCEPTS a weight in pounds, and that is the honest limit of this check", () => {
    // Not an oversight — pinned deliberately so nobody later reads the range as
    // a unit guard and relaxes something on that belief.
    //
    // Height works because feet and centimetres do not overlap: every feet
    // entry sat between 5 and 7, so a floor of 100 catches all of them.
    // Kilogrammes and pounds overlap across the entire plausible human range —
    // 70kg and 154lb are both ordinary numbers — so no bound can separate them.
    //
    // What catches the wrong unit is the frontend labelling the field. This
    // range catches a typo and an absurd value, and nothing else.
    assert.equal(validateWeight(154), null);
    assert.equal(validateWeight(220), null);
  });
});
