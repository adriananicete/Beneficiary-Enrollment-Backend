import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";
import { makeNext, makeReq, makeRes } from "../helpers/http.js";

const { markDeceased, timelineOf } = await import("../../src/controllers/deceasedController.js");

// Marking an employee deceased. The scoping and the date are checked again in
// the procedures, read back 2026-10-12, and proven by the manual run. What is
// tested here is what this side decides.

describe("timelineOf — the enrollment's dates, as the checks need them", () => {
  test("the birthdate arrives as text and is used as it is", () => {
    assert.equal(timelineOf({ birthdate: "1990-05-01" }).birthdate, "1990-05-01");
  });

  // The enrollment date is a datetime. 16:30 UTC on 30 July is half past
  // midnight on 31 July in the Philippines, which is the date that counts.
  test("the enrollment date is read in Philippine time", () => {
    assert.equal(timelineOf({ enrollment_date: new Date("2026-07-30T16:30:00Z") }).enrollmentDate, "2026-07-31");
    assert.equal(timelineOf({ enrollment_date: new Date("2026-07-30T08:37:17Z") }).enrollmentDate, "2026-07-30");
  });

  test("an employee with no active enrollment has nothing to check against", () => {
    assert.deepEqual(timelineOf(undefined), { birthdate: undefined, enrollmentDate: undefined });
  });
});

// getPool is never reached, so these run without a database.
describe("markDeceased — refused before the database", () => {
  const call = async (body) => {
    const next = makeNext();
    await markDeceased(makeReq({ params: { client_id: "75" }, body, user: { user_id: 3 } }), makeRes(), next);
    return next.refusal();
  };

  test("a missing or malformed date", async () => {
    assert.deepEqual(await call({}), { statusCode: 400, message: "date_of_death must be a date in YYYY-MM-DD format" });
    assert.deepEqual(await call({ date_of_death: "10/12/2026" }), {
      statusCode: 400,
      message: "date_of_death must be a date in YYYY-MM-DD format",
    });
    assert.equal((await call(undefined))?.statusCode, 400);
  });

  test("a date that does not exist", async () => {
    assert.deepEqual(await call({ date_of_death: "2026-02-30" }), { statusCode: 400, message: "date_of_death is not a real date" });
  });

  test("a date in the future", async () => {
    const nextYear = `${new Date().getFullYear() + 1}-01-01`;

    assert.deepEqual(await call({ date_of_death: nextYear }), {
      statusCode: 400,
      message: "The date of death cannot be in the future",
    });
  });
});
