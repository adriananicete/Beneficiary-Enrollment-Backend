import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  normaliseContactNo,
  validateContactNo,
} from "../../src/utils/validateContactNo.js";
import {
  normaliseSssGsisNo,
  validateSssGsisNo,
} from "../../src/utils/validateSssGsisNo.js";

// Every fixture below is a real value from dbo.clients, read 2026-09-07. The
// rules were fitted to what is in the column rather than to what a phone number
// is supposed to look like.

describe("normaliseContactNo", () => {
  test("leaves a correct 09 number alone", () => {
    for (const number of ["09171234567", "09551234567", "09223456781"])
      assert.equal(normaliseContactNo(number), number);
  });

  test("folds +63 to a leading zero", () => {
    // Sixteen rows were in this shape, and +639171234567 and 09171234567 were
    // both present as separate values — the same number stored two ways.
    assert.equal(normaliseContactNo("+639171234567"), "09171234567");
    assert.equal(normaliseContactNo("+639914877549"), "09914877549");
  });

  test("folds a bare 63 prefix too", () => {
    assert.equal(normaliseContactNo("639171234567"), "09171234567");
  });

  test("strips the separators people type", () => {
    assert.equal(normaliseContactNo("0917 123 4567"), "09171234567");
    assert.equal(normaliseContactNo("0917-123-4567"), "09171234567");
    assert.equal(normaliseContactNo("+63 917 123 4567"), "09171234567");
  });

  test("does not turn a non-mobile into a mobile", () => {
    // The +63 rule is anchored on the 9 that follows the country code, so a
    // landline is handed back untouched rather than rewritten into something
    // that would pass. Asserted through the validator, because "what does it
    // return" is less important than "does it still get refused".
    const landline = "+6328123456";

    assert.equal(normaliseContactNo(landline), landline);
    assert.match(validateContactNo(normaliseContactNo(landline)), /starting with 09/);
  });

  test("hands back what it cannot make sense of", () => {
    assert.equal(normaliseContactNo("not a number"), "not a number");
    assert.equal(normaliseContactNo(undefined), undefined);
  });
});

describe("validateContactNo", () => {
  test("accepts 11 digits starting 09", () => {
    for (const number of ["09171234567", "09201239876", "09771234567"])
      assert.equal(validateContactNo(number), null, number);
  });

  test("refuses the +63 form, because it validates what will be stored", () => {
    assert.match(validateContactNo("+639171234567"), /starting with 09/);
  });

  test("refuses a landline", () => {
    assert.match(validateContactNo("0281234567"), /starting with 09/);
  });

  test("refuses the wrong digit count", () => {
    assert.match(validateContactNo("0917123456"), /starting with 09/);
    assert.match(validateContactNo("091712345678"), /starting with 09/);
  });

  test("refuses the TIN that is sitting in this column today", () => {
    // `543453566` is a real value in contact_no in dbo.clients — the same
    // string that is also in that row's tin_id and sss_gsis_no. Somebody filled
    // one value into three fields. This is the class of thing the rule catches
    // from now on; the existing row is untouched.
    assert.match(validateContactNo("543453566"), /starting with 09/);
  });

  test("refuses letters and a non-string", () => {
    assert.match(validateContactNo("0917ABCD567"), /starting with 09/);
    assert.match(validateContactNo(9171234567), /starting with 09/);
    assert.match(validateContactNo(undefined), /starting with 09/);
  });
});

describe("normaliseSssGsisNo", () => {
  test("leaves a dashed SSS number alone", () => {
    for (const number of ["14-7852963-0", "62-4395817-4", "92-7461583-0"])
      assert.equal(normaliseSssGsisNo(number), number);
  });

  test("adds the dashes to a bare ten-digit SSS number", () => {
    // Eleven rows are in this shape today, alongside 26 already dashed.
    assert.equal(normaliseSssGsisNo("1234567890"), "12-3456789-0");
    assert.equal(normaliseSssGsisNo("3398271045"), "33-9827104-5");
  });

  test("leaves an eleven-digit GSIS number bare", () => {
    // Grouping these the same way would invent a format nobody uses.
    assert.equal(normaliseSssGsisNo("12345678901"), "12345678901");
  });

  test("strips spaces and dashes before deciding which it is", () => {
    assert.equal(normaliseSssGsisNo("12 3456789 0"), "12-3456789-0");
    assert.equal(normaliseSssGsisNo("1-2-3-4-5-6-7-8-9-0"), "12-3456789-0");
  });

  test("hands back a digit count that is neither", () => {
    assert.equal(normaliseSssGsisNo("543453566"), "543453566");
    assert.equal(normaliseSssGsisNo("1234567890111"), "1234567890111");
    assert.equal(normaliseSssGsisNo(undefined), undefined);
  });
});

describe("validateSssGsisNo", () => {
  test("accepts the dashed SSS form", () => {
    for (const number of ["12-3456789-0", "74-5258693-5", "39-1728645-8"])
      assert.equal(validateSssGsisNo(number), null, number);
  });

  test("accepts the bare eleven-digit GSIS form", () => {
    assert.equal(validateSssGsisNo("12345678901"), null);
  });

  test("refuses a bare ten-digit, because it validates what will be stored", () => {
    assert.match(validateSssGsisNo("1234567890"), /10 digits/);
  });

  test("refuses the values that are junk in the column today", () => {
    // All five are real rows in dbo.clients. They are not refused
    // retroactively — validation only runs on what is submitted from now on —
    // but they are the reason no future rule can assume the column is uniform.
    for (const junk of [
      "543453566",
      "1234567890111",
      "12111111111111111",
      "1222222222222222222",
      "111111111111111111111",
    ])
      assert.match(validateSssGsisNo(junk), /10 digits/, junk);
  });

  test("refuses a dashed number grouped the wrong way", () => {
    assert.match(validateSssGsisNo("123-456789-0"), /10 digits/);
    assert.match(validateSssGsisNo("12-34567890"), /10 digits/);
  });

  test("the message names both accepted shapes", () => {
    const message = validateSssGsisNo("nope");

    assert.match(message, /12-3456789-0/);
    assert.match(message, /12345678901/);
  });
});
