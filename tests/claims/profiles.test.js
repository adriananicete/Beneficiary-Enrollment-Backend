import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { GENERAL, profileOf } from "../../src/claims/profiles.js";

describe("profileOf", () => {
  test("the four claim types the form knows are read from the type's code", () => {
    assert.equal(profileOf("DEATH"), "death");
    assert.equal(profileOf("TPD"), "tpd");
    assert.equal(profileOf("TERMINAL_ILLNESS"), "terminal_illness");
    assert.equal(profileOf("DISMEMBERMENT"), "dismemberment");
  });

  test("every other type is general: the three TEST-* types and whatever is added later", () => {
    for (const code of ["TEST-CLAIM", "TEST-DEATH", "NO-DOCS", "", "death", "Death", " DEATH"])
      assert.equal(profileOf(code), GENERAL, JSON.stringify(code));
  });

  // A missing code is a type the form cannot know; it must not throw or pick a profile.
  test("a code that is missing, or is not text, is general", () => {
    for (const code of [undefined, null, 0, {}, ["DEATH"]]) assert.equal(profileOf(code), GENERAL);
  });

  // The table is a plain object, and a plain object has inherited names.
  test("a name every object has is not a profile", () => {
    for (const code of ["constructor", "toString", "__proto__", "hasOwnProperty"])
      assert.equal(profileOf(code), GENERAL, code);
  });
});
