import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { addMonths, ageOn, checkLoan, limitsOf, limitsProblem, parseDay, wholeNumber } from "../../src/gcli/loanRules.js";
import { LIMITS } from "../helpers/gcliStore.js";

// The server counts a loan the way the frontend's src/utils/loanRules.js does, so
// these are the same cases as that file's tests.

describe("wholeNumber", () => {
  test("takes a JSON integer or digits, up to 9 of them, and nothing else", () => {
    assert.equal(wholeNumber(850000), 850000);
    assert.equal(wholeNumber("850000"), 850000);
    assert.equal(wholeNumber(999999999), 999999999);
    for (const bad of [1000000000, "1000000000", 1.5, "1.5", "1e3", -5, "-5", "ten", "", null, undefined, {}, NaN])
      assert.equal(wholeNumber(bad), null, String(bad));
  });
});

describe("limitsProblem", () => {
  test("a full set of limits passes, with or without the no-medical limit", () => {
    assert.equal(limitsProblem(LIMITS), null);
    assert.equal(limitsProblem({ ...LIMITS, no_medical_limit: null }), null);
    const { no_medical_limit, ...without } = LIMITS;
    assert.equal(limitsProblem(without), null);
  });

  test("every other limit is required and must be a whole number from 1", () => {
    for (const field of ["min_loan", "max_loan", "max_term_months", "min_entry_age", "max_entry_age", "max_maturity_age"]) {
      assert.match(limitsProblem({ ...LIMITS, [field]: null }), new RegExp(`${field} is required`));
      assert.match(limitsProblem({ ...LIMITS, [field]: 0 }), /whole number from 1/);
      assert.match(limitsProblem({ ...LIMITS, [field]: 1.5 }), /whole number from 1/);
      assert.match(limitsProblem({ ...LIMITS, [field]: "ten" }), /whole number from 1/);
    }
  });

  test("a limit has a size the database holds, and a term a sane ceiling", () => {
    assert.equal(limitsProblem({ ...LIMITS, max_loan: 999999999, no_medical_limit: null }), null);
    assert.match(limitsProblem({ ...LIMITS, max_loan: 1000000000 }), /max_loan/);
    assert.equal(limitsProblem({ ...LIMITS, max_term_months: 600 }), null);
    assert.match(limitsProblem({ ...LIMITS, max_term_months: 601 }), /at most 600/);
  });

  test("the ranges make sense", () => {
    assert.match(limitsProblem({ ...LIMITS, max_loan: 40000 }), /max_loan cannot be below min_loan/);
    assert.match(limitsProblem({ ...LIMITS, min_entry_age: 17 }), /at least 18/);
    assert.match(limitsProblem({ ...LIMITS, max_entry_age: 101 }), /at most 100/);
    assert.match(limitsProblem({ ...LIMITS, min_entry_age: 40, max_entry_age: 30 }), /max_entry_age cannot be below/);
    assert.match(limitsProblem({ ...LIMITS, max_maturity_age: 60 }), /max_maturity_age cannot be below/);
    assert.match(limitsProblem({ ...LIMITS, max_maturity_age: 121 }), /at most 120/);
    assert.match(limitsProblem({ ...LIMITS, no_medical_limit: 6000000 }), /no_medical_limit cannot be above/);
  });

  test("a field that is not a limit is refused, so a misspelt one is not dropped", () => {
    assert.match(limitsProblem({ ...LIMITS, max_loans: 1 }), /max_loans is not a loan limit/);
    for (const bad of [null, "limits", [], 5]) assert.match(limitsProblem(bad), /must be an object/);
  });

  test("limitsOf keeps whole numbers and null for no no-medical limit", () => {
    assert.deepEqual(limitsOf({ ...LIMITS, max_loan: "5000000", no_medical_limit: undefined }), { ...LIMITS, no_medical_limit: null });
  });
});

describe("dates", () => {
  test("a day is a real YYYY-MM-DD date or nothing", () => {
    assert.deepEqual(parseDay("2026-11-02"), { year: 2026, month: 11, day: 2 });
    for (const bad of ["2026-02-30", "2026-13-01", "2026-1-1", "", null, undefined, 20261102]) assert.equal(parseDay(bad), null, String(bad));
  });

  test("age is taken at the last birthday", () => {
    assert.equal(ageOn("1992-03-14", "2026-11-02"), 34);
    assert.equal(ageOn("1992-03-14", "2026-03-13"), 33);
    assert.equal(ageOn("1992-03-14", "2026-03-14"), 34);
    assert.equal(ageOn("2000-02-29", "2026-02-28"), 25);
    assert.equal(ageOn("", "2026-03-14"), null);
    assert.equal(ageOn("1992-03-14", "not a date"), null);
  });

  test("the loan ends on the release date plus the term, cut to the month's last day", () => {
    assert.equal(addMonths("2026-11-02", 36), "2029-11-02");
    assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
    assert.equal(addMonths("2027-01-31", 1), "2027-02-28");
    assert.equal(addMonths("2028-01-31", 1), "2028-02-29");
    assert.equal(addMonths("2026-12-15", 1), "2027-01-15");
    assert.equal(addMonths("nope", 1), null);
  });
});

describe("checkLoan", () => {
  const good = { loan_amount: 850000, term_months: 36, release_date: "2026-11-02" };
  const check = (loan, birthdate = "1992-03-14") => checkLoan(LIMITS, loan, birthdate, "Bluepoint");

  test("a loan inside every limit passes, with its dates and ages", () => {
    const result = check(good);
    assert.deepEqual(result.reasons, []);
    assert.equal(result.maturityDate, "2029-11-02");
    assert.equal(result.ageAtEntry, 34);
    assert.equal(result.ageAtMaturity, 37);
    assert.equal(result.aboveNoMedicalLimit, false);
  });

  test("an amount outside the limits is refused in plain words", () => {
    assert.deepEqual(check({ ...good, loan_amount: 6200000 }).reasons, ["Bluepoint covers loans up to PHP 5,000,000."]);
    assert.deepEqual(check({ ...good, loan_amount: 10000 }).reasons, ["Bluepoint covers loans of PHP 50,000 or more."]);
  });

  test("a term past the longest is refused, and a zero term", () => {
    assert.deepEqual(check({ ...good, term_months: 72 }).reasons, ["Bluepoint covers terms up to 60 months."]);
    assert.equal(check({ ...good, term_months: 0 }).reasons.length, 1);
  });

  test("a value exactly at a limit passes, and one step past it fails", () => {
    assert.deepEqual(check({ ...good, loan_amount: 50000 }).reasons, []);
    assert.equal(check({ ...good, loan_amount: 49999 }).reasons.length, 1);
    assert.deepEqual(check({ ...good, loan_amount: 5000000 }).reasons, []);
    assert.equal(check({ ...good, loan_amount: 5000001 }).reasons.length, 1);
    assert.deepEqual(check({ ...good, term_months: 60 }).reasons, []);
    assert.equal(check({ ...good, term_months: 61 }).reasons.length, 1);
    // age at entry: 18 and 65 on the release date (2026-11-02)
    assert.deepEqual(check(good, "2008-11-02").reasons, [], "turns 18 that day");
    assert.equal(check(good, "2008-11-03").reasons.length, 1, "turns 18 the next day");
    assert.deepEqual(check(good, "1961-11-02").reasons, [], "turns 65 that day");
    assert.equal(check(good, "1960-11-02").reasons.length, 1, "turns 66 that day");
  });

  test("the age at the end of the loan is held to its own limit", () => {
    // released 2026-11-02, ends 2031-11-02; a tighter limit than the entry age allows for
    const tight = { ...LIMITS, max_maturity_age: 66 };
    const ends = (birthdate) => checkLoan(tight, { ...good, term_months: 60 }, birthdate, "Bluepoint").reasons;
    assert.deepEqual(ends("1965-11-02"), [], "61 when released, 66 on the day it ends");
    assert.match(ends("1964-11-02").join(" "), /would end when you are 67. Bluepoint covers loans that end by age 66/);
  });

  test("a date that is not one, or a value that is not a number, is a reason, never a pass", () => {
    assert.equal(check({ ...good, release_date: "2026-02-30" }).reasons.length, 1);
    assert.equal(check({ ...good, loan_amount: "99999999999999999999" }).reasons.length, 1);
    assert.equal(check({ ...good, loan_amount: NaN }).reasons.length, 1);
  });

  test("a loan above the no-medical limit is flagged but not refused", () => {
    const result = check({ ...good, loan_amount: 1250000 });
    assert.deepEqual(result.reasons, []);
    assert.equal(result.aboveNoMedicalLimit, true);
    assert.equal(checkLoan({ ...LIMITS, no_medical_limit: null }, { ...good, loan_amount: 4000000 }, "1992-03-14").aboveNoMedicalLimit, false);
  });
});
