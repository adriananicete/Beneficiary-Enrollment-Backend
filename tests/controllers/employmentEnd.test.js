import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";
import { makeNext, makeReq, makeRes } from "../helpers/http.js";

const { endEmployment } = await import("../../src/controllers/employmentEndController.js");

// The body is checked before a connection is taken, so getPool is never
// reached and these run without a database.
describe("endEmployment — refused before the database", () => {
  const call = async (body) => {
    const next = makeNext();
    const res = makeRes();
    await endEmployment(makeReq({ params: { client_id: "75" }, body, user: { user_id: 3 } }), res, next);
    return { refusal: next.refusal(), res };
  };

  test("a missing reason", async () => {
    const { refusal, res } = await call({ end_date: "2026-11-20" });

    assert.deepEqual(refusal, {
      statusCode: 400,
      message: "reason must be one of RESIGNED, TERMINATED, CONTRACT_ENDED, RETIRED",
    });
    assert.equal(res.statusCode, null);
  });

  test("a date in the future", async () => {
    const nextYear = `${new Date().getFullYear() + 1}-01-01`;

    assert.deepEqual((await call({ reason: "RETIRED", end_date: nextYear })).refusal, {
      statusCode: 400,
      message: "The end date cannot be in the future",
    });
  });

  test("no body", async () => {
    assert.equal((await call(undefined)).refusal?.statusCode, 400);
  });
});
