import { describe, test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

import "../helpers/env.js";
import { fakePool, inputsFor, queryMatching } from "../helpers/fakePool.js";

const { default: AuthService } = await import("../../src/services/authService.js");
const { default: config } = await import("../../src/config/env.js");
const {
  EMPLOYEE,
  ADMIN,
  SUPER_ADMIN,
  SESSION_EXPIRY,
  REMEMBER_ME_EXPIRY,
  RESET_TOKEN_EXPIRY,
} = await import("../../src/utils/constants.js");

// The two logins were two copies of this, and every decision in here was
// verified once by hand on 2026-09-04 and watched by nothing afterwards.
//
// Cost 4 rather than the 10 used in production. The cost is stored in the hash,
// so compare behaves identically and the suite does not spend a second and a
// half proving bcrypt works.
const PASSWORD = "SecurePass@123";
const HASH = bcrypt.hashSync(PASSWORD, 4);

const LOGIN = "sec.us01_usp_login";

const employeeRow = (overrides = {}) => ({
  us01_user_id: 12,
  us01_username: "EMP-020",
  us01_password: HASH,
  us01_is_active: true,
  us01_is_locked: false,
  us01_must_change_password: false,
  us02_role_id: 3,
  us02_role_name: EMPLOYEE,
  ...overrides,
});

const hrRow = (overrides = {}) =>
  employeeRow({
    us01_user_id: 3,
    us01_username: "hr.coforge",
    us02_role_id: 2,
    us02_role_name: ADMIN,
    ...overrides,
  });

// The two doors, as the controllers configure them.
const EMPLOYEE_DOOR = {
  allowedRoles: [EMPLOYEE],
  wrongDoorMessage: "Admin and HR must use the admin login",
};

const ADMIN_DOOR = {
  allowedRoles: [SUPER_ADMIN, ADMIN],
  wrongDoorMessage: "Employees must use the employee login",
};

const login = (row, credentials, door = EMPLOYEE_DOOR) => {
  const { pool, calls } = fakePool({ [LOGIN]: row ? [row] : [] });

  return {
    calls,
    result: AuthService.login(pool, { ...door, ...credentials }),
  };
};

const good = { username: "EMP-020", password: PASSWORD };

describe("authService — refusing", () => {
  // The employee login had no such guard. bcrypt.compare(undefined, hash)
  // throws "data and hash arguments required", which is not an AppError, so
  // errorHandler rendered a generic 500 for a request that was simply missing a
  // field. Neither login route has a body validator in front of it.
  test("a missing password is 400, not a crash", async () => {
    await assert.rejects(
      () => login(employeeRow(), { username: "EMP-020" }).result,
      (error) => error.statusCode === 400 && /All fields required/.test(error.message),
    );
  });

  test("a missing username is 400", async () => {
    await assert.rejects(
      () => login(employeeRow(), { password: PASSWORD }).result,
      (error) => error.statusCode === 400,
    );
  });

  test("an unknown username is 401", async () => {
    await assert.rejects(
      () => login(null, good).result,
      (error) => error.statusCode === 401,
    );
  });

  test("a wrong password is 401", async () => {
    await assert.rejects(
      () => login(employeeRow(), { ...good, password: "WrongPass@123" }).result,
      (error) => error.statusCode === 401,
    );
  });

  // Uniform on purpose. A different message for each would let anybody with the
  // login page work out which usernames exist.
  test("an unknown user and a wrong password are indistinguishable", async () => {
    const unknown = await login(null, good).result.catch((error) => error);
    const wrong = await login(employeeRow(), { ...good, password: "WrongPass@123" }).result.catch(
      (error) => error,
    );

    assert.equal(unknown.message, wrong.message);
    assert.equal(unknown.statusCode, wrong.statusCode);
  });

  test("a closed account is 403 once the password is right", async () => {
    await assert.rejects(
      () => login(employeeRow({ us01_is_active: false }), good).result,
      (error) => error.statusCode === 403 && /no longer active/.test(error.message),
    );
  });

  test("a locked account is 403", async () => {
    await assert.rejects(
      () => login(employeeRow({ us01_is_locked: true }), good).result,
      (error) => error.statusCode === 403,
    );
  });

  // The ordering is the security decision, and it is the one thing here that
  // looks like an accident and is not. Only somebody who has already proved
  // they know the password learns that the account exists but is closed, so a
  // caller guessing passwords is told nothing they did not already have.
  test("a closed account with the WRONG password is 401, not 403", async () => {
    await assert.rejects(
      () =>
        login(employeeRow({ us01_is_active: false }), {
          ...good,
          password: "WrongPass@123",
        }).result,
      (error) => error.statusCode === 401,
    );
  });

  test("an employee is refused at the admin door", async () => {
    await assert.rejects(
      () => login(employeeRow(), good, ADMIN_DOOR).result,
      (error) =>
        error.statusCode === 403 && /Employees must use the employee login/.test(error.message),
    );
  });

  test("an HR is refused at the employee door", async () => {
    await assert.rejects(
      () => login(hrRow(), { ...good, username: "hr.coforge" }, EMPLOYEE_DOOR).result,
      (error) =>
        error.statusCode === 403 && /Admin and HR must use the admin login/.test(error.message),
    );
  });

  // Same reasoning as the closed-account ordering: the wrong door is only
  // reported to somebody who proved the password first.
  test("the wrong door with a wrong password is 401, not 403", async () => {
    await assert.rejects(
      () =>
        login(employeeRow(), { ...good, password: "WrongPass@123" }, ADMIN_DOOR).result,
      (error) => error.statusCode === 401,
    );
  });
});

describe("authService — the forced password change", () => {
  const mustChange = () => employeeRow({ us01_must_change_password: true });

  // This is the whole point of PR #70. Before it, the caller was told to change
  // their password and given nothing to change it with, and no session either,
  // so a seeded HR account could not be used at all.
  test("returns a reset token and says so", async () => {
    const { result } = login(mustChange(), good);
    const answer = await result;

    assert.equal(answer.mustChangePassword, true);
    assert.ok(answer.resetToken, "no reset token was issued");
    assert.equal(answer.maxAge, RESET_TOKEN_EXPIRY);
  });

  // The assertion that matters most in this file. A session token on this path
  // would let somebody the forced password change is meant to stop walk
  // straight in.
  test("issues NO session token on this path", async () => {
    const { result } = login(mustChange(), good);
    const answer = await result;

    assert.equal(answer.token, undefined, "a session token was issued alongside the reset token");
  });

  test("the reset token is a key to one action, not a session", async () => {
    const { result } = login(mustChange(), good);
    const { resetToken } = await result;

    const claims = jwt.verify(resetToken, config.jwtSecret);

    assert.equal(claims.purpose, "password_reset");
    assert.equal(claims.username, "EMP-020");
    // No role on it, so it cannot be mistaken for a session token by anything
    // that reads one.
    assert.equal(claims.role_name, undefined);
    assert.equal(claims.exp - claims.iat, RESET_TOKEN_EXPIRY / 1000);
  });

  // Fifteen minutes whatever the caller asked for. rememberMe is a session
  // preference and this is not a session.
  test("rememberMe cannot extend the reset token", async () => {
    const { result } = login(mustChange(), { ...good, rememberMe: true });
    const { resetToken, maxAge } = await result;

    const claims = jwt.verify(resetToken, config.jwtSecret);

    assert.equal(maxAge, RESET_TOKEN_EXPIRY);
    assert.equal(claims.exp - claims.iat, RESET_TOKEN_EXPIRY / 1000);
  });

  // The password has not been changed yet, so nothing has happened worth
  // recording as a sign-in.
  test("does not record a last login", async () => {
    const { calls, result } = login(mustChange(), good);
    await result;

    assert.equal(
      queryMatching(calls, /us01_last_login/),
      undefined,
      "recorded a login for somebody who has not finished logging in",
    );
  });
});

describe("authService — the session", () => {
  test("carries the identity and the role the rest of the API reads", async () => {
    const { result } = login(employeeRow(), good);
    const { token } = await result;

    const claims = jwt.verify(token, config.jwtSecret);

    assert.equal(claims.user_id, 12);
    assert.equal(claims.username, "EMP-020");
    assert.equal(claims.role_id, 3);
    assert.equal(claims.role_name, EMPLOYEE);
    // Not a reset token. verifyResetToken checks this claim, and a session
    // token carrying it would be spendable on the change-password endpoint.
    assert.equal(claims.purpose, undefined);
  });

  test("is eight hours by default", async () => {
    const { result } = login(hrRow(), { ...good, username: "hr.coforge" }, ADMIN_DOOR);
    const answer = await result;

    assert.equal(answer.maxAge, SESSION_EXPIRY);
  });

  test("is thirty days when the caller asked to be remembered", async () => {
    const { result } = login(
      hrRow(),
      { ...good, username: "hr.coforge", rememberMe: true },
      ADMIN_DOOR,
    );
    const answer = await result;

    assert.equal(answer.maxAge, REMEMBER_ME_EXPIRY);
  });

  // The cookie lifetime and the token lifetime used to be written out
  // separately — maxAge: REMEMBER_ME_EXPIRY beside expiresIn: "30d". PARK.md §3
  // recommends shortening the rememberMe window and calls it "one constant in
  // constants.js"; doing that would have expired the cookie sooner and left the
  // token valid for thirty days, so the session would look over while anybody
  // holding the token kept access.
  for (const [label, rememberMe] of [
    ["the ordinary session", false],
    ["a remembered session", true],
  ]) {
    test(`${label} expires the token exactly when the cookie does`, async () => {
      const { result } = login(
        hrRow(),
        { ...good, username: "hr.coforge", rememberMe },
        ADMIN_DOOR,
      );
      const { token, maxAge } = await result;

      const claims = jwt.verify(token, config.jwtSecret);

      assert.equal(claims.exp - claims.iat, maxAge / 1000);
    });
  }

  test("records the last login for the account that signed in", async () => {
    const { calls, result } = login(employeeRow(), good);
    await result;

    const recorded = queryMatching(calls, /us01_last_login/);

    assert.ok(recorded, "no last login was recorded");
    assert.equal(recorded.inputs.us01_username, "EMP-020");
  });

  test("looks the user up by the username it was given", async () => {
    const { calls, result } = login(employeeRow(), good);
    await result;

    assert.equal(inputsFor(calls, LOGIN).us01_username, "EMP-020");
  });
});
