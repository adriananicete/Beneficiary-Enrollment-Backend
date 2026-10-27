import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  GENDERS,
  normaliseGender,
  validateGender,
} from "../../src/utils/validateGender.js";
import {
  CIVIL_STATUSES,
  normaliseCivilStatus,
  validateCivilStatus,
} from "../../src/utils/validateCivilStatus.js";
import { validateZipCode } from "../../src/utils/validateZipCode.js";

describe("the sets themselves", () => {
  // Literals rather than assertions against the arrays, which cannot fail.
  // These are a business decision from 2026-09-07, so changing one should
  // break a test rather than pass quietly.
  test("gender is M, F, O — single characters, because the column is char(1)", () => {
    assert.deepEqual(GENDERS, ["M", "F", "O"]);
    for (const g of GENDERS) assert.equal(g.length, 1);
  });

  test("the six civil statuses, in the casing they are stored in", () => {
    assert.deepEqual(CIVIL_STATUSES, [
      "Single",
      "Married",
      "Widowed",
      "Legally Separated",
      "Divorced",
      "Annulled",
    ]);
  });

  test("every civil status fits varchar(20)", () => {
    // "Legally Separated" is 17. A seventh value longer than 20 would be
    // truncated on the way in and this is the only thing that would say so.
    for (const status of CIVIL_STATUSES)
      assert.ok(status.length <= 20, `${status} is ${status.length} characters`);
  });
});

describe("normaliseGender", () => {
  test("folds the words the form sends down to the stored character", () => {
    assert.equal(normaliseGender("Male"), "M");
    assert.equal(normaliseGender("female"), "F");
    assert.equal(normaliseGender("OTHER"), "O");
  });

  test("accepts the character itself, in either case", () => {
    assert.equal(normaliseGender("M"), "M");
    assert.equal(normaliseGender("f"), "F");
  });

  test("trims", () => {
    assert.equal(normaliseGender("  Male  "), "M");
  });

  test("hands back anything it does not recognise, for the validator to refuse", () => {
    assert.equal(normaliseGender("Unicorn"), "UNICORN");
    assert.equal(normaliseGender(undefined), undefined);
    assert.equal(normaliseGender(7), 7);
  });
});

describe("validateGender", () => {
  test("accepts the three stored values", () => {
    assert.equal(validateGender("M"), null);
    assert.equal(validateGender("F"), null);
    assert.equal(validateGender("O"), null);
  });

  test("refuses the word, because it validates what will be stored", () => {
    // Deliberate. The middleware normalises first, so by the time this runs the
    // word is already a character. Validating the raw word here would let an
    // unnormalised value through if the two steps ever came apart.
    assert.match(validateGender("Male"), /must be one of/);
  });

  test("refuses anything outside the set", () => {
    assert.match(validateGender("X"), /must be one of/);
    assert.match(validateGender(""), /must be one of/);
    assert.match(validateGender(undefined), /must be one of/);
  });
});

describe("normaliseCivilStatus", () => {
  test("folds case to the stored form", () => {
    assert.equal(normaliseCivilStatus("single"), "Single");
    assert.equal(normaliseCivilStatus("MARRIED"), "Married");
    assert.equal(normaliseCivilStatus("legally separated"), "Legally Separated");
  });

  test("trims", () => {
    assert.equal(normaliseCivilStatus("  Widowed "), "Widowed");
  });

  test("does not guess at internal spacing", () => {
    // "Legally  Separated" with two spaces is refused rather than repaired.
    // Forgiving case is forgiving a keyboard; forgiving arbitrary whitespace is
    // guessing at intent, and that is how a set stops being a set.
    assert.equal(normaliseCivilStatus("Legally  Separated"), "Legally  Separated");
    assert.match(validateCivilStatus(normaliseCivilStatus("Legally  Separated")), /must be one of/);
  });

  test("hands back what it does not recognise", () => {
    assert.equal(normaliseCivilStatus("Complicated"), "Complicated");
    assert.equal(normaliseCivilStatus(null), null);
  });
});

describe("validateCivilStatus", () => {
  test("accepts all six", () => {
    for (const status of CIVIL_STATUSES)
      assert.equal(validateCivilStatus(status), null, status);
  });

  test("refuses a near miss", () => {
    assert.match(validateCivilStatus("Seperated"), /must be one of/);
    assert.match(validateCivilStatus("Separated"), /must be one of/);
    assert.match(validateCivilStatus("single"), /must be one of/);
  });

  test("names the six in the message, so the caller can fix it", () => {
    const message = validateCivilStatus("Complicated");

    for (const status of CIVIL_STATUSES) assert.ok(message.includes(status));
  });
});

describe("validateZipCode", () => {
  test("accepts four digits", () => {
    assert.equal(validateZipCode("1100"), null);
  });

  test("accepts a leading zero, which is why this stays a string", () => {
    // The same trap that stripped barangay_id when it was bound as BIGINT.
    assert.equal(validateZipCode("0900"), null);
  });

  test("refuses four characters that are not digits", () => {
    // The length cap already allowed these through — it could stop a fifth
    // character but not four of the wrong kind.
    assert.match(validateZipCode("abcd"), /exactly 4 digits/);
    assert.match(validateZipCode("11 0"), /exactly 4 digits/);
    assert.match(validateZipCode("1-10"), /exactly 4 digits/);
  });

  test("refuses the wrong length", () => {
    assert.match(validateZipCode("110"), /exactly 4 digits/);
    assert.match(validateZipCode("11000"), /exactly 4 digits/);
  });

  test("refuses a number, because a leading zero would already be gone", () => {
    assert.match(validateZipCode(1100), /exactly 4 digits/);
  });
});
