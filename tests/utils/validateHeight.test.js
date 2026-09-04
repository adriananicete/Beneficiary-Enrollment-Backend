import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { validateHeight } from "../../src/utils/validateHeight.js";

describe("validateHeight", () => {
  test("accepts ordinary heights in centimetres", () => {
    for (const height of [100, 163.5, 174, 250, "171.5"]) {
      assert.equal(validateHeight(height), null, `height=${height}`);
    }
  });

  test("refuses a height entered in feet", () => {
    // The value this range exists for. Thirty-eight records were stored in feet
    // before anyone noticed, because nothing on the form said which unit and
    // nothing checked. Every feet entry found sat between 5 and 7.
    for (const feet of [5, 5.8, 6.92, 7]) {
      assert.match(validateHeight(feet), /centimetres/, `height=${feet}`);
    }
  });

  test("refuses a transposition like 17 for 170", () => {
    assert.match(validateHeight(17), /between 100 and 250/);
  });

  test("refuses a height above the ceiling", () => {
    assert.match(validateHeight(251), /between 100 and 250/);
  });

  test("refuses a value that is not a number, and says so differently", () => {
    // Two distinct messages on purpose: "not a number" and "not in range" are
    // different mistakes and the employee can only fix one of them.
    assert.match(validateHeight("abc"), /must be a number/);
    assert.match(validateHeight(undefined), /must be a number/);
  });

  test("empty and null coerce to zero, so they fail on range rather than type", () => {
    // Number('') and Number(null) are both 0. Pinned because the message is
    // then about centimetres rather than about the value being missing, and a
    // required-field check upstream is what makes that acceptable.
    assert.match(validateHeight(""), /between 100 and 250/);
    assert.match(validateHeight(null), /between 100 and 250/);
  });
});
