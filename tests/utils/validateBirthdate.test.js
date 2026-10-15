import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_EMPLOYEE_AGE,
  MIN_EMPLOYEE_AGE,
  ageAtLastBirthday,
  validateBirthdate,
} from "../../src/utils/validateBirthdate.js";

// Ages are computed against today, so a fixed birthdate would drift into and
// out of range as the years pass and this suite would start failing on a date
// nobody chose. Built from the current year instead.
const yearsAgo = (years, month = "06", day = "15") =>
  `${new Date().getFullYear() - years}-${month}-${day}`;

describe("the employee age bounds", () => {
  // Literals, not the constants. Asserting MIN against MIN_EMPLOYEE_AGE cannot
  // fail — the same mistake found in parsePaging on 2026-09-04.
  test("the floor is 18", () => {
    assert.equal(MIN_EMPLOYEE_AGE, 18);
  });

  test("the ceiling is 100", () => {
    assert.equal(MAX_EMPLOYEE_AGE, 100);
  });
});

describe("validateBirthdate — shape", () => {
  test("accepts an ordinary birthdate", () => {
    assert.equal(validateBirthdate(yearsAgo(30)), null);
  });

  test("refuses anything that is not YYYY-MM-DD", () => {
    assert.match(validateBirthdate("14/05/1990"), /YYYY-MM-DD/);
    assert.match(validateBirthdate("May 14 1990"), /YYYY-MM-DD/);
    assert.match(validateBirthdate("1990-5-14"), /YYYY-MM-DD/);
  });

  test("refuses a value that is not a string", () => {
    assert.match(validateBirthdate(undefined), /YYYY-MM-DD/);
    assert.match(validateBirthdate(null), /YYYY-MM-DD/);
    assert.match(validateBirthdate(19900514), /YYYY-MM-DD/);
  });

  test("refuses a date that looks real and is not", () => {
    // The whole reason the parts are checked after parsing. `new Date` accepts
    // this and silently returns 2 March, so without the round-trip check a
    // typo becomes a real date that nobody ever questions.
    assert.match(validateBirthdate("1990-02-30"), /not a real date/);
    assert.match(validateBirthdate("1990-13-01"), /not a real date/);
    assert.match(validateBirthdate("1990-04-31"), /not a real date/);
  });

  test("accepts a real leap day and refuses a fake one", () => {
    assert.equal(validateBirthdate("1992-02-29"), null);
    assert.match(validateBirthdate("1991-02-29"), /not a real date/);
  });
});

describe("validateBirthdate — range", () => {
  test("refuses a date in the future, and says so specifically", () => {
    const nextYear = `${new Date().getFullYear() + 1}-01-01`;

    assert.match(validateBirthdate(nextYear), /cannot be in the future/);
  });

  test("refuses someone too young to be an employee", () => {
    assert.match(validateBirthdate(yearsAgo(10)), /between 18 and 100/);
  });

  test("refuses a mistyped year", () => {
    // 1890 rather than 1980 — the error this bound actually exists to catch.
    assert.match(validateBirthdate("1890-06-15"), /between 18 and 100/);
  });

  test("the boundary itself, on both sides", () => {
    const today = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const month = pad(today.getMonth() + 1);
    const day = pad(today.getDate());

    // Their 18th birthday is today — allowed.
    assert.equal(
      validateBirthdate(`${today.getFullYear() - 18}-${month}-${day}`),
      null,
    );

    // One day short of 18 — refused. This is the case an off-by-one in the
    // birthday-not-yet-had adjustment would let through.
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    assert.match(
      validateBirthdate(
        `${tomorrow.getFullYear() - 18}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`,
      ),
      /between 18 and 100/,
    );
  });
});

// Age at last birthday, the contract's definition, shared by validateBirthdate
// and the company's online age limit. A fixed "today" so the boundaries are
// exact and do not drift.
describe("ageAtLastBirthday", () => {
  const today = new Date(2026, 9, 15); // 15 October 2026, local

  test("turns over on the birthday itself, not the day after", () => {
    assert.equal(ageAtLastBirthday("1960-10-15", today), 66);
    assert.equal(ageAtLastBirthday("1960-10-16", today), 65);
    assert.equal(ageAtLastBirthday("1960-10-14", today), 66);
  });

  test("a birthday later in the year has not come round yet", () => {
    assert.equal(ageAtLastBirthday("1961-12-31", today), 64);
    assert.equal(ageAtLastBirthday("1961-01-01", today), 65);
  });

  // Born on 29 February: in a common year the birthday is reached on 1 March.
  test("a leap-day birthday in a common year", () => {
    assert.equal(ageAtLastBirthday("1960-02-29", new Date(2026, 1, 28)), 65);
    assert.equal(ageAtLastBirthday("1960-02-29", new Date(2026, 2, 1)), 66);
  });

  test("anything that is not YYYY-MM-DD is null, never an age", () => {
    for (const value of [undefined, null, "", "15/10/1960", 19601015])
      assert.equal(ageAtLastBirthday(value, today), null, JSON.stringify(value));
  });

  test("validateBirthdate still draws its 18 to 100 line with it", () => {
    assert.equal(validateBirthdate(yearsAgo(40)), null);
    assert.match(validateBirthdate(yearsAgo(101)), /between 18 and 100/);
  });
});
