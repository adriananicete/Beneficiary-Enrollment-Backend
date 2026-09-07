import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { normaliseTinId, validateTinId } from "../../src/utils/validateTinId.js";

// Taken from the 42 TINs in dbo.clients, read 2026-09-07. Both lengths were
// already in use, so both have to keep working — this is not a new rule being
// imposed on a clean column, it is a rule being fitted to data that exists.
const NINE_DIGIT = ["147-852-963", "927-461-583", "543-453-566"];
const TWELVE_DIGIT = ["123-456-789-000", "000-000-000-000", "221-884-901-000"];

describe("normaliseTinId", () => {
  test("leaves an already-correct TIN alone, in both lengths", () => {
    for (const tin of [...NINE_DIGIT, ...TWELVE_DIGIT])
      assert.equal(normaliseTinId(tin), tin);
  });

  test("adds the dashes to a bare nine-digit TIN", () => {
    // The one real row this fixes. `543453566` sits in dbo.clients today, and
    // under the exact-string check behind 50009 it does not collide with
    // `543-453-566` — the same taxpayer could hold two client rows.
    assert.equal(normaliseTinId("543453566"), "543-453-566");
  });

  test("adds the dashes to a bare twelve-digit TIN", () => {
    assert.equal(normaliseTinId("123456789000"), "123-456-789-000");
  });

  test("regroups dashes in the wrong places", () => {
    // Nine digits are nine digits. The dashes are presentation; where somebody
    // put them while typing is not part of the identity.
    assert.equal(normaliseTinId("123-45-6789"), "123-456-789");
    assert.equal(normaliseTinId("1-2-3-4-5-6-7-8-9"), "123-456-789");
  });

  test("trims", () => {
    assert.equal(normaliseTinId("  147-852-963  "), "147-852-963");
  });

  test("hands back anything it cannot make sense of, for the validator", () => {
    assert.equal(normaliseTinId("12345"), "12345");
    assert.equal(normaliseTinId("1234567890"), "1234567890");
    assert.equal(normaliseTinId("abc-def-ghi"), "abc-def-ghi");
    assert.equal(normaliseTinId(undefined), undefined);
    assert.equal(normaliseTinId(147852963), 147852963);
  });
});

describe("validateTinId", () => {
  test("accepts both stored lengths", () => {
    for (const tin of [...NINE_DIGIT, ...TWELVE_DIGIT])
      assert.equal(validateTinId(tin), null, tin);
  });

  test("refuses a bare TIN, because it validates what will be stored", () => {
    // Deliberate, and the same shape as validateGender. The middleware
    // normalises first, so by the time this runs the dashes are there.
    // Validating the bare form here would let an unnormalised value through if
    // the two steps ever came apart.
    assert.match(validateTinId("543453566"), /9 or 12 digits/);
  });

  test("refuses a digit count that is neither 9 nor 12", () => {
    assert.match(validateTinId("147-852-96"), /9 or 12 digits/);
    assert.match(validateTinId("147-852-963-00"), /9 or 12 digits/);
    assert.match(validateTinId("147-852-963-0000"), /9 or 12 digits/);
  });

  test("refuses letters", () => {
    assert.match(validateTinId("abc-def-ghi"), /9 or 12 digits/);
    assert.match(validateTinId("147-852-96X"), /9 or 12 digits/);
  });

  test("refuses a missing value and a non-string", () => {
    assert.match(validateTinId(undefined), /9 or 12 digits/);
    assert.match(validateTinId(""), /9 or 12 digits/);
    assert.match(validateTinId(147852963), /9 or 12 digits/);
  });

  test("the message shows both accepted shapes", () => {
    const message = validateTinId("nope");

    assert.match(message, /123-456-789/);
    assert.match(message, /123-456-789-000/);
  });
});

describe("what this deliberately does NOT do", () => {
  test("nine and twelve stay distinct, so the same taxpayer can hold both", () => {
    // Recorded as a test rather than only a comment, because it is a decision
    // and not an oversight. The last three digits are a branch code rather
    // than part of a person's identity, and three rows in the live data share
    // the base 123-456-789 across different branch codes. Treating the two
    // lengths as one identity was considered on 2026-09-07 and not chosen.
    //
    // If that ever changes, this test is what should go red first.
    assert.notEqual(
      normaliseTinId("123-456-789"),
      normaliseTinId("123-456-789-000"),
    );

    assert.equal(validateTinId("123-456-789"), null);
    assert.equal(validateTinId("123-456-789-000"), null);
  });
});
