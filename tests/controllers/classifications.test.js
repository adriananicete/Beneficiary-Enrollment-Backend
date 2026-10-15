import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";
import { makeNext, makeReq, makeRes } from "../helpers/http.js";

const { getEmployeeClassifications } = await import(
  "../../src/controllers/enrollmentController.js"
);

// GET /enrollment/classifications needs the invitation token since DBA request
// 23. It needs no account, so the token is checked before the database the
// way GET /enrollment/invitation checks it. getPool is never reached, so these
// run without one.
describe("getEmployeeClassifications — refused before the database", () => {
  test("no token is 400", async () => {
    const next = makeNext();

    await getEmployeeClassifications(makeReq(), makeRes(), next);

    assert.deepEqual(next.refusal(), { statusCode: 400, message: "Token is required" });
  });

  // 404, the answer a token that does not exist gets. A token sent twice
  // (?token=a&token=b) arrives as an array and is refused the same way.
  for (const [label, token] of [
    ["too long", "a".repeat(65)],
    ["not hex", "z".repeat(64)],
    ["sent twice", ["a".repeat(64), "b".repeat(64)]],
  ])
    test(`a token that cannot be one (${label}) is 404`, async () => {
      const next = makeNext();

      await getEmployeeClassifications(makeReq({ query: { token } }), makeRes(), next);

      assert.deepEqual(next.refusal(), { statusCode: 404, message: "Invitation not found" });
    });
});
