import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { relationshipOf } from "../../src/claims/relationships.js";

describe("relationshipOf", () => {
  test("reads every relationship BES has enrolled onto the claim form's list", () => {
    const enrolled = {
      Spouse: "SPOUSE", Husband: "SPOUSE", Wife: "SPOUSE",
      Child: "CHILD", Son: "CHILD", Daughter: "CHILD",
      Parent: "PARENT", Father: "PARENT", Mother: "PARENT",
      Sibling: "SIBLING", Brother: "SIBLING", Sister: "SIBLING",
      Aunt: "OTHER_BENEFICIARY", Other: "OTHER_BENEFICIARY",
    };

    for (const [text, expected] of Object.entries(enrolled)) assert.equal(relationshipOf(text), expected, text);
  });

  test("ignores case and spaces around the text", () => {
    assert.equal(relationshipOf("  WIFE "), "SPOUSE");
    assert.equal(relationshipOf("son"), "CHILD");
  });

  test("a relationship it does not know, or no text at all, is other beneficiary", () => {
    for (const value of ["Cousin", "", "   ", null, undefined, 5, {}, ["Wife"], "constructor", "__proto__", "toString"])
      assert.equal(relationshipOf(value), "OTHER_BENEFICIARY", String(value));
  });
});
