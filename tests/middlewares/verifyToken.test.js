import { describe, test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";

import { JWT_SECRET } from "../helpers/env.js";
import { makeNext, makeReq, makeRes, silenceConsoleError } from "../helpers/http.js";

const { createVerifyToken } = await import("../../src/middlewares/verifyToken.js");
const { AppError } = await import("../../src/utils/AppError.js");

// verifyToken is the door to every authenticated route. Since 2026-10-06 it
// asks the database on every request, through verifySession, so a logout, a
// password change or a closed account ends the session instead of leaving the
// token working for up to thirty days. What is tested here is the door: what
// it sends to verifySession, what it does with each answer, and what happens
// to the cookie. verifySession itself is tested in authService.test.js.

const CLAIMS = { user_id: 12, username: "EMP-020", role_id: 3, role_name: "Employee", token_version: 4 };
const POOL = { fake: "pool" };

// Runs the middleware with the two dependencies replaced, and records what
// each was asked.
const run = async ({ token, verifySession = async () => {}, getPool = async () => POOL } = {}) => {
  const asked = { getPool: 0, verifySession: [] };

  const verifyToken = createVerifyToken({
    getPool: async () => {
      asked.getPool += 1;
      return getPool();
    },
    verifySession: async (pool, session) => {
      asked.verifySession.push({ pool, session });
      return verifySession(pool, session);
    },
  });

  const req = makeReq({ cookies: token === undefined ? {} : { token } });
  const res = makeRes();
  const next = makeNext();

  const restore = silenceConsoleError();
  try {
    await verifyToken(req, res, next);
  } finally {
    restore();
  }

  return { req, res, next, asked };
};

const signed = (claims = CLAIMS, options = { expiresIn: 3600 }) =>
  jwt.sign(claims, JWT_SECRET, options);

describe("verifyToken — before the database", () => {
  test("no cookie is 401, and nothing is asked", async () => {
    const { next, asked } = await run();

    assert.equal(next.refusal().statusCode, 401);
    assert.equal(asked.getPool, 0);
  });

  test("a forged or expired token is 401, and nothing is asked", async () => {
    for (const token of [
      jwt.sign(CLAIMS, "not-the-secret-not-the-secret-not-the"),
      signed(CLAIMS, { expiresIn: -10 }),
      "not-a-jwt",
    ]) {
      const { next, asked } = await run({ token });

      assert.equal(next.refusal().statusCode, 401, token.slice(0, 20));
      assert.equal(asked.getPool, 0);
    }
  });
});

describe("verifyToken — the session check", () => {
  test("a session verifySession accepts passes, with the token's claims on req.user", async () => {
    const { req, next } = await run({ token: signed() });

    assert.ok(next.passed());
    assert.equal(req.user.user_id, 12);
    assert.equal(req.user.token_version, 4);
  });

  test("hands verifySession the pool and the decoded token", async () => {
    const { asked } = await run({ token: signed() });

    assert.equal(asked.verifySession.length, 1);
    assert.equal(asked.verifySession[0].pool, POOL);
    assert.equal(asked.verifySession[0].session.token_version, 4);
    assert.equal(asked.verifySession[0].session.user_id, 12);
  });

  // The session is over: logged out elsewhere, password changed, account
  // closed. The cookie goes with it, or the browser would send it, and have it
  // refused, on every request after this one.
  test("a 401 from verifySession refuses the request and clears the cookie", async () => {
    const { req, res, next } = await run({
      token: signed(),
      verifySession: async () => {
        throw new AppError("Your session has ended. Please sign in again.", 401);
      },
    });

    assert.equal(next.refusal().statusCode, 401);
    assert.deepEqual(res.clearedCookies, ["token"]);
    assert.equal(req.user, undefined, "req.user was set for a refused session");
  });

  // A database that is down must not sign everybody out.
  test("any other failure is passed on with the cookie left alone", async () => {
    const deadlock = Object.assign(new Error("deadlock"), { number: 1205 });

    const { req, res, next } = await run({
      token: signed(),
      verifySession: async () => {
        throw deadlock;
      },
    });

    assert.equal(next.calls[0], deadlock);
    assert.deepEqual(res.clearedCookies, []);
    assert.equal(req.user, undefined);
  });

  test("a database that cannot be reached is passed on with the cookie left alone", async () => {
    const unreachable = new Error("ECONNREFUSED");

    const { res, next, asked } = await run({
      token: signed(),
      getPool: async () => {
        throw unreachable;
      },
    });

    assert.equal(next.calls[0], unreachable);
    assert.deepEqual(res.clearedCookies, []);
    assert.equal(asked.verifySession.length, 0);
  });
});
