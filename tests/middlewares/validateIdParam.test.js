import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  isInvitationToken,
  isNumericId,
  validateIdParam,
} from "../../src/middlewares/validateIdParam.js";
import { makeNext, makeReq, makeRes } from "../helpers/http.js";

describe("isNumericId", () => {
  test("accepts a plain id", () => {
    for (const value of ["1", "64", "007", 42]) {
      assert.equal(isNumericId(value), true, `value=${value}`);
    }
  });

  test('refuses "agreements" — the path segment that caused a 500', () => {
    // GET /admin/enrollments/agreements has no route of its own, so Express
    // matches it against /enrollments/:client_id with client_id = "agreements".
    // Bound as sql.BigInt that fails inside the driver and surfaces as a
    // generic 500 with a stack trace, for what is a typo in a URL.
    assert.equal(isNumericId("agreements"), false);
  });

  test("refuses a route name that sits beside a parameterised route", () => {
    // /change-requests/pending-count only escapes the parameterised route
    // because it is declared above it. If that order is ever reversed, this is
    // the value that would arrive.
    assert.equal(isNumericId("pending-count"), false);
  });

  test("refuses partial numbers, empties and negatives", () => {
    for (const value of ["", "12abc", "-4", "1.5", " 7 ", undefined, null]) {
      assert.equal(isNumericId(value), false, `value=${JSON.stringify(value)}`);
    }
  });
});

describe("isInvitationToken", () => {
  const token = "a".repeat(64);

  test("accepts 64 hex characters in either case", () => {
    assert.equal(isInvitationToken(token), true);
    assert.equal(isInvitationToken(token.toUpperCase()), true);
    assert.equal(isInvitationToken("0123456789abcdef".repeat(4)), true);
  });

  test("refuses 65 characters — the string that cost half a test run", () => {
    // The token is crypto.randomBytes(32).toString("hex"), exactly 64, and the
    // binding is NVarChar(64). One character over and the driver rejects it
    // before the procedure runs, which used to surface as a 500 on a public
    // endpoint. Copying from the emailed link is how it happens — it is easy to
    // bring "?token=" along or a trailing newline.
    assert.equal(isInvitationToken("a".repeat(65)), false);
  });

  test("refuses 63 characters and non-hex characters", () => {
    assert.equal(isInvitationToken("a".repeat(63)), false);
    assert.equal(isInvitationToken("z".repeat(64)), false);
  });

  test("refuses empty and non-strings", () => {
    for (const value of ["", undefined, null, 123]) {
      assert.equal(
        isInvitationToken(value),
        false,
        `value=${JSON.stringify(value)}`,
      );
    }
  });
});

describe("validateIdParam", () => {
  const middleware = validateIdParam("request_id", "Change request not found");

  test("lets a real id through", () => {
    const next = makeNext();

    middleware(makeReq({ params: { request_id: "12" } }), makeRes(), next);

    assert.ok(next.passed());
  });

  test("answers 404, not 400, for an id that cannot be an id", () => {
    // An id that cannot exist is answered exactly like one that does not exist.
    // A caller trying ids learns nothing from the difference, and a mistyped
    // URL deserves nothing better.
    const next = makeNext();

    middleware(makeReq({ params: { request_id: "abc" } }), makeRes(), next);

    assert.deepEqual(next.refusal(), {
      statusCode: 404,
      message: "Change request not found",
    });
  });

  test("uses the message it was given, so each route says its own thing", () => {
    const next = makeNext();
    const invitation = validateIdParam(
      "invitation_id",
      "Enrollment invitation does not exist",
    );

    invitation(makeReq({ params: { invitation_id: "x" } }), makeRes(), next);

    assert.match(next.refusal().message, /invitation/);
  });

  test("a missing parameter is refused rather than passed through", () => {
    const next = makeNext();

    middleware(makeReq(), makeRes(), next);

    assert.equal(next.refusal().statusCode, 404);
  });
});
