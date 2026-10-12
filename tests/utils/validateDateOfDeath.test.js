import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { validateDateOfDeath } from "../../src/utils/validateDateOfDeath.js";

// The date of death, decided 2026-10-06 and 2026-10-12: a real date, not in
// the future, not before the birthdate, not before the enrollment date. Every
// date is "YYYY-MM-DD" text and compared as text.

const TODAY = "2026-10-12";

describe("validateDateOfDeath — the shape", () => {
  test("a real date up to today passes", () => {
    for (const value of ["2026-10-12", "2026-10-11", "2024-02-29"])
      assert.equal(validateDateOfDeath(value, { today: TODAY }), null, value);
  });

  test("anything but YYYY-MM-DD text is refused", () => {
    for (const value of [undefined, null, "", "2026-10-1", "12/10/2026", "2026-10-12T00:00:00Z", " 2026-10-12", 20261012, {}, ["2026-10-12"]])
      assert.equal(
        validateDateOfDeath(value, { today: TODAY }),
        "date_of_death must be a date in YYYY-MM-DD format",
        JSON.stringify(value),
      );
  });

  // new Date("2026-02-30") quietly becomes 2 March.
  test("a date that does not exist is refused", () => {
    for (const value of ["2026-02-30", "2025-02-29", "2026-13-01", "2026-00-10", "2026-04-31"])
      assert.equal(validateDateOfDeath(value, { today: TODAY }), "date_of_death is not a real date", value);
  });

  test("tomorrow is refused, today is not", () => {
    assert.equal(validateDateOfDeath("2026-10-13", { today: TODAY }), "The date of death cannot be in the future");
    assert.equal(validateDateOfDeath("2026-10-12", { today: TODAY }), null);
  });

  // With no today given, it is the process's own date, which timezone.js
  // makes the Philippine one. A year ahead is the future whatever the hour.
  test("today defaults to the date this process is in", () => {
    const nextYear = `${new Date().getFullYear() + 1}-01-01`;

    assert.equal(validateDateOfDeath(nextYear), "The date of death cannot be in the future");
  });
});

describe("validateDateOfDeath — against the employee's own dates", () => {
  const timeline = { today: TODAY, birthdate: "1990-05-01", enrollmentDate: "2026-07-30" };

  test("before the birthdate is refused, on it is not", () => {
    const noEnrollment = { today: TODAY, birthdate: "1990-05-01" };

    assert.equal(validateDateOfDeath("1990-04-30", noEnrollment), "The date of death cannot be before the birthdate");
    assert.equal(validateDateOfDeath("1990-05-01", noEnrollment), null);
  });

  // Pending with the business, and refused until they answer.
  test("before the enrollment date is refused, on it is not", () => {
    assert.equal(validateDateOfDeath("2026-07-29", timeline), "The date of death cannot be before the enrollment date");
    assert.equal(validateDateOfDeath("2026-07-30", timeline), null);
  });

  test("with no birthdate or enrollment date known, those checks are skipped", () => {
    assert.equal(validateDateOfDeath("1980-01-01", { today: TODAY }), null);
  });
});
