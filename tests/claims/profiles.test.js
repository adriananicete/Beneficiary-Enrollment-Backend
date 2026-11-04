import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import { GENERAL, profileOf } from "../../src/claims/profiles.js";

describe("profileOf", () => {
  test("the four claim types the form knows are read from the type's code", () => {
    assert.equal(profileOf("DEATH"), "death");
    assert.equal(profileOf("DEATH_HR"), "death", "the death claim HR files has the death form too");
    assert.equal(profileOf("TPD"), "tpd");
    assert.equal(profileOf("TERMINAL_ILLNESS"), "terminal_illness");
    assert.equal(profileOf("DISMEMBERMENT"), "dismemberment");
  });

  test("every other type is general, whatever is added later", () => {
    for (const code of ["NO-DOCS", "", "death", "Death", " DEATH"]) assert.equal(profileOf(code), GENERAL, JSON.stringify(code));
  });

  describe("the TEST-* types of the development database", () => {
    const original = process.env.CLAIM_DETAILS_DEV_STORE;

    afterEach(() => {
      if (original === undefined) delete process.env.CLAIM_DETAILS_DEV_STORE;
      else process.env.CLAIM_DETAILS_DEV_STORE = original;
    });

    test("are general while the development store is off", () => {
      delete process.env.CLAIM_DETAILS_DEV_STORE;

      for (const code of ["TEST-CLAIM", "TEST-END", "TEST-DEATH"]) assert.equal(profileOf(code), GENERAL, code);
    });

    test("stand in for three of the forms while it is on", () => {
      process.env.CLAIM_DETAILS_DEV_STORE = "true";

      assert.equal(profileOf("TEST-DEATH"), "death");
      assert.equal(profileOf("TEST-END"), "tpd");
      assert.equal(profileOf("TEST-CLAIM"), "dismemberment");
      assert.equal(profileOf("NO-DOCS"), GENERAL, "no other type is touched");
      assert.equal(profileOf("TEST-OTHER"), GENERAL);
      assert.equal(profileOf("DEATH"), "death", "a real code is unchanged");
    });
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
