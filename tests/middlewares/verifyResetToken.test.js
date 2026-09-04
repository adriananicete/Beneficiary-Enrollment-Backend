// This file needs src/config/env.js to load, which throws on import when any
// required variable is missing. The helper sets them in-process, and the
// middleware is imported dynamically afterwards — a static import would be
// hoisted above the assignments and defeat it.
//
// Nothing here reaches the database. env.js validates and builds a config
// object; db.js is a separate module and is never imported.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";

import { JWT_SECRET } from "../helpers/env.js";
import { makeNext, makeReq, makeRes, silenceConsoleError } from "../helpers/http.js";

const { verifyResetToken } = await import(
  "../../src/middlewares/verifyResetToken.js"
);

let restoreConsole;

before(() => {
  // The failure paths log the JWT error, which is right in production.
  restoreConsole = silenceConsoleError();
});

after(() => restoreConsole());

const sign = (payload, options = {}) =>
  jwt.sign(payload, JWT_SECRET, { expiresIn: "15m", ...options });

const run = (reset_token) => {
  const req = makeReq({ cookies: reset_token ? { reset_token } : {} });
  const next = makeNext();

  verifyResetToken(req, makeRes(), next);

  return { req, next };
};

describe("verifyResetToken", () => {
  test("accepts a reset token and puts the caller on req.resetUser", () => {
    // resetUser, not user. The change-password controller reads the username
    // from here rather than from the body, so the caller cannot change somebody
    // else's password.
    const { req, next } = run(
      sign({ user_id: 5, username: "EMP-020", purpose: "password_reset" }),
    );

    assert.ok(next.passed());
    assert.equal(req.resetUser.username, "EMP-020");
    assert.equal(req.user, undefined);
  });

  test("401 when there is no cookie", () => {
    // Also what a second attempt gets: the cookie is cleared on success, so
    // repeating the request answers this rather than a validation error.
    const refusal = run(undefined).next.refusal();

    assert.deepEqual(refusal, {
      statusCode: 401,
      message: "No reset token provided",
    });
  });

  test("403 for a session token used on the change-password route", () => {
    // A full session token is validly signed and must still be refused here.
    // Without the purpose claim, any signed-in user could change a password
    // using the session they already hold.
    const refusal = run(
      sign({ user_id: 5, username: "EMP-020", role_name: "Employee" }),
    ).next.refusal();

    assert.deepEqual(refusal, {
      statusCode: 403,
      message: "Invalid token purpose",
    });
  });

  test("403 for a token whose purpose is something else entirely", () => {
    const refusal = run(sign({ purpose: "email_verification" })).next.refusal();

    assert.equal(refusal.statusCode, 403);
  });

  test("401 for a token signed with the wrong secret", () => {
    const forged = jwt.sign({ purpose: "password_reset" }, "not-the-secret");

    assert.equal(run(forged).next.refusal().statusCode, 401);
  });

  test("401 for an expired token", () => {
    const expired = jwt.sign(
      { purpose: "password_reset" },
      JWT_SECRET,
      { expiresIn: "-1s" },
    );

    const refusal = run(expired).next.refusal();

    assert.equal(refusal.statusCode, 401);
    assert.match(refusal.message, /Invalid or expired token/);
  });

  test("401 for a malformed cookie value", () => {
    assert.equal(run("not-a-jwt").next.refusal().statusCode, 401);
  });
});
