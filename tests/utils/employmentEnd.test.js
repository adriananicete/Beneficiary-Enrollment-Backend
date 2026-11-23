import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  EMPLOYMENT_END_LABELS,
  EMPLOYMENT_END_REASONS,
  isActivelyEnrolled,
  parseEmploymentEnd,
} from "../../src/utils/employmentEnd.js";

// What HR sends to end an employment, DBA request 39. The procedure checks the
// reason and the date again (50238, 50244); these are the readable answers.

const TODAY = "2026-11-23";
const parse = (body) => parseEmploymentEnd(body, { today: TODAY });

const refusal = (body) => {
  try {
    parse(body);
    return null;
  } catch (error) {
    return { statusCode: error.statusCode, message: error.message };
  }
};

describe("parseEmploymentEnd — the reason", () => {
  // Pinned as literals: the CHECK constraint on client_employers holds exactly
  // these four, and the frontend's dropdown is built from them.
  test("the four reasons, and no other", () => {
    assert.deepEqual(EMPLOYMENT_END_REASONS, ["RESIGNED", "TERMINATED", "CONTRACT_ENDED", "RETIRED"]);

    for (const reason of EMPLOYMENT_END_REASONS)
      assert.deepEqual(parse({ reason, end_date: "2026-11-20" }), { reason, endDate: "2026-11-20" });
  });

  test("a missing, unknown or lower-case reason is refused", () => {
    const expected = { statusCode: 400, message: "reason must be one of RESIGNED, TERMINATED, CONTRACT_ENDED, RETIRED" };

    assert.deepEqual(refusal({ end_date: "2026-11-20" }), expected);
    assert.deepEqual(refusal({ reason: "OTHER", end_date: "2026-11-20" }), expected);
    assert.deepEqual(refusal({ reason: "resigned", end_date: "2026-11-20" }), expected);
  });
});

describe("parseEmploymentEnd — the date", () => {
  test("today is allowed, tomorrow is not", () => {
    assert.deepEqual(parse({ reason: "RESIGNED", end_date: TODAY }), { reason: "RESIGNED", endDate: TODAY });
    assert.deepEqual(refusal({ reason: "RESIGNED", end_date: "2026-11-24" }), {
      statusCode: 400,
      message: "The end date cannot be in the future",
    });
  });

  test("a missing date has its own sentence", () => {
    assert.deepEqual(refusal({ reason: "RESIGNED" }), { statusCode: 400, message: "end_date is required" });
    assert.deepEqual(refusal({ reason: "RESIGNED", end_date: "" }), { statusCode: 400, message: "end_date is required" });
  });

  test("a malformed or impossible date is refused, not rolled over", () => {
    const expected = { statusCode: 400, message: "end_date must be a date written as YYYY-MM-DD" };

    assert.deepEqual(refusal({ reason: "RESIGNED", end_date: "11/20/2026" }), expected);
    assert.deepEqual(refusal({ reason: "RESIGNED", end_date: "2026-02-30" }), expected);
    assert.deepEqual(refusal({ reason: "RESIGNED", end_date: 20261120 }), expected);
  });
});

describe("parseEmploymentEnd — the body", () => {
  test("no body at all", () => {
    assert.deepEqual(refusal(undefined), { statusCode: 400, message: "reason and end_date are required" });
    assert.deepEqual(refusal([]), { statusCode: 400, message: "reason and end_date are required" });
  });

  // A key the form does not have is refused by name, as the company and
  // affiliate forms do, so a typo is not silently ignored.
  test("an unknown key is refused by name", () => {
    assert.deepEqual(refusal({ reason: "RESIGNED", end_date: "2026-11-20", remarks: "x" }), {
      statusCode: 400,
      message: "remarks is not a field of an employment end",
    });
  });
});

describe("isActivelyEnrolled — one row of the HR list", () => {
  test("an enrollment whose employment has not ended", () => {
    assert.equal(isActivelyEnrolled({ enrollment_id: "54", employment_end_reason: null }), true);
    assert.equal(isActivelyEnrolled({ enrollment_id: "54" }), true);
  });

  // Since request 39 the list brings the closed enrollment of an ended
  // employment, so an enrollment_id alone no longer means enrolled.
  test("the closed enrollment of an ended employment is not", () => {
    assert.equal(isActivelyEnrolled({ enrollment_id: "54", employment_end_reason: "RESIGNED" }), false);
  });

  test("no enrollment is not", () => {
    assert.equal(isActivelyEnrolled({ enrollment_id: null }), false);
    assert.equal(isActivelyEnrolled(undefined), false);
  });
});

describe("EMPLOYMENT_END_LABELS", () => {
  test("every reason has words for a person", () => {
    for (const reason of EMPLOYMENT_END_REASONS) assert.ok(EMPLOYMENT_END_LABELS[reason], reason);
    assert.equal(EMPLOYMENT_END_LABELS.CONTRACT_ENDED, "Contract ended");
  });
});
