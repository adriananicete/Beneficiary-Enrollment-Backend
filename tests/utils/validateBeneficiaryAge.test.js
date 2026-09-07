import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_BENEFICIARY_AGE,
  MIN_BENEFICIARY_AGE,
  validateBeneficiaryAge,
} from "../../src/utils/validateBeneficiaryAge.js";

describe("the beneficiary age bounds", () => {
  test("the floor is 0, and that is the point of this change", () => {
    assert.equal(MIN_BENEFICIARY_AGE, 0);
  });

  test("the ceiling is 120", () => {
    assert.equal(MAX_BENEFICIARY_AGE, 120);
  });
});

describe("validateBeneficiaryAge", () => {
  test("ACCEPTS zero — a newborn is an ordinary beneficiary", () => {
    // The defect this replaced: both middlewares guarded with `if (!age)`,
    // which is false for 0, so naming a baby was refused with "Beneficiary age
    // is required" — an error about presence when the value was present.
    assert.equal(validateBeneficiaryAge(0), null);
    assert.equal(validateBeneficiaryAge("0"), null);
  });

  test("accepts ordinary ages", () => {
    assert.equal(validateBeneficiaryAge(12), null);
    assert.equal(validateBeneficiaryAge(61), null);
    assert.equal(validateBeneficiaryAge("35"), null);
  });

  test("still reports a genuinely missing age as missing", () => {
    assert.match(validateBeneficiaryAge(undefined), /required/);
    assert.match(validateBeneficiaryAge(null), /required/);
    assert.match(validateBeneficiaryAge(""), /required/);
  });

  test("refuses a value that is not a number", () => {
    // Binds to sql.Int. Before this, a non-numeric age reached the database and
    // came back as a conversion error, which the caller saw as a 500.
    assert.match(validateBeneficiaryAge("abc"), /whole number/);
    assert.match(validateBeneficiaryAge({}), /whole number/);
  });

  test("refuses a fraction", () => {
    assert.match(validateBeneficiaryAge(2.5), /whole number/);
  });

  test("refuses a negative age and an impossible one", () => {
    assert.match(validateBeneficiaryAge(-1), /between 0 and 120/);
    assert.match(validateBeneficiaryAge(200), /between 0 and 120/);
  });
});
