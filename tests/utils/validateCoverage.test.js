import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { validateCoverage } from "../../src/utils/validateCoverage.js";

const beneficiary = (coverage_percent) => ({
  full_name: "Someone",
  relationship: "Child",
  age: 10,
  coverage_percent,
});

describe("validateCoverage", () => {
  test("accepts a set totalling exactly 100", () => {
    assert.equal(validateCoverage([beneficiary(60), beneficiary(40)]), null);
  });

  test("an empty list is allowed", () => {
    // Enrolling without naming anybody is permitted; the export reports it as
    // the "who has nominated nobody" case rather than treating it as an error.
    assert.equal(validateCoverage([]), null);
  });

  test("refuses anything that is not an array", () => {
    assert.match(validateCoverage(undefined), /must be an array/);
    assert.match(validateCoverage(null), /must be an array/);
    assert.match(validateCoverage("60"), /must be an array/);
  });

  test("refuses a total that is not 100, and says what it currently is", () => {
    const message = validateCoverage([
      beneficiary(40),
      beneficiary(40),
      beneficiary(40),
    ]);

    assert.match(message, /exactly 100%/);
    assert.match(message, /currently 120%/);
  });

  test("refuses a percentage that is not a whole number", () => {
    assert.match(
      validateCoverage([beneficiary(33.5), beneficiary(66.5)]),
      /Beneficiary 1: coverage percent must be a whole number/,
    );
  });

  test("refuses a percentage outside 5 to 100", () => {
    assert.match(validateCoverage([beneficiary(0)]), /between 5 and 100/);
    assert.match(validateCoverage([beneficiary(105)]), /between 5 and 100/);
  });

  test("refuses a percentage that is not a multiple of 5", () => {
    // Whole multiples of five are why this rule has no floating point in it at
    // all, and why no epsilon tolerance is needed anywhere.
    assert.match(
      validateCoverage([beneficiary(33), beneficiary(67)]),
      /multiple of 5/,
    );
  });

  test("refuses more than ten beneficiaries", () => {
    const eleven = Array.from({ length: 11 }, () => beneficiary(5));

    assert.match(validateCoverage(eleven), /maximum of 10/);
  });

  test("names the offending beneficiary by its position in the list", () => {
    assert.match(
      validateCoverage([beneficiary(50), beneficiary(33)]),
      /Beneficiary 2:/,
    );
  });

  test("coerces a numeric string and writes it back to the caller's object", () => {
    // Surprising and load-bearing: the function mutates its input. The service
    // relies on the coerced number being there afterwards, so "50" arriving
    // from a form must not stay a string.
    const beneficiaries = [
      { ...beneficiary("60") },
      { ...beneficiary("40") },
    ];

    assert.equal(validateCoverage(beneficiaries), null);
    assert.equal(beneficiaries[0].coverage_percent, 60);
    assert.equal(typeof beneficiaries[0].coverage_percent, "number");
  });
});
