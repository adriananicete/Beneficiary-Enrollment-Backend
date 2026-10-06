import { describe, test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

import "../helpers/env.js";
import { fakePool, inputsFor, callTo } from "../helpers/fakePool.js";

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
const BY_ID = "sec.us01_usp_sel_user_by_id";
const EMPLOYERS = "sec.us08_usp_sel_employers_by_user";
const FAILED = "sec.us01_usp_login_failed";
const SUCCEEDED = "sec.us01_usp_login_succeeded";

// What sec.us01_usp_login_failed answers for an attempt that did not lock.
const NOT_LOCKED = [{ us01_failed_login_attempts: 1, lock_seconds_remaining: 0 }];

// What sec.us01_usp_login really does with an unknown username: it THROWs
// 50037, it does not return an empty result. The number can sit on the error
// or one level down, CLAUDE.md §5. Answering with [] instead is how a test
// once called the two cases indistinguishable while the real ones were not.
const unknownUsername = (nested = false) => () => {
  const error = new Error("Invalid username or password.");
  if (nested) error.originalError = { number: 50037 };
  else error.number = 50037;
  throw error;
};

const employeeRow = (overrides = {}) => ({
  us01_user_id: 12,
  us01_username: "EMP-020",
  us01_password: HASH,
  us01_first_name: "Juan",
  us01_middle_name: "Santos",
  us01_last_name: "Dela Cruz",
  us01_email_address: "juan.delacruz@example.com",
  us01_is_active: true,
  us01_is_locked: false,
  // Computed by sec.us01_usp_login since DBA request 18. 0 means not locked.
  lock_seconds_remaining: 0,
  // Returned by both login procedures since DBA request 18. Not 0, so a token
  // missing the claim cannot pass by matching a default.
  us01_token_version: 4,
  us01_must_change_password: false,
  us02_role_id: 3,
  us02_role_name: EMPLOYEE,
  ...overrides,
});

const hrRow = (overrides = {}) =>
  employeeRow({
    us01_user_id: 3,
    us01_username: "hr.coforge",
    us01_first_name: "Maria",
    us01_middle_name: "",
    us01_last_name: "Reyes",
    us01_email_address: "hr@coforge.example.com",
    us02_role_id: 2,
    us02_role_name: ADMIN,
    ...overrides,
  });

// What sec.us01_usp_sel_user_by_id returns for the same person, read from the
// procedure on 2026-09-23: the login's columns plus client_id and a few
// timestamps, and without us01_must_change_password. It carries the password
// hash too, which is the reason the tests below look for it in the answer.
const byIdRow = (row) => {
  const { us01_must_change_password, ...rest } = row;
  return {
    ...rest,
    client_id: row.us02_role_name === EMPLOYEE ? 98 : null,
    us01_failed_login_attempts: 0,
    us01_last_login: new Date("2026-09-23T09:00:00Z"),
    us01_created_date: new Date("2026-09-01T09:00:00Z"),
    us01_modified_date: null,
  };
};

// As the procedure returns them, company_code included.
const COFORGE = { employer_id: 1, company_code: "COF", company_name: "Coforge BPS Philippines, Inc." };

// The two doors, as the controllers configure them.
const EMPLOYEE_DOOR = {
  allowedRoles: [EMPLOYEE],
  wrongDoorMessage: "Admin and HR must use the admin login",
};

const ADMIN_DOOR = {
  allowedRoles: [SUPER_ADMIN, ADMIN],
  wrongDoorMessage: "Employees must use the employee login",
};

// A successful login now also reads the profile, so the by-id and employer
// lookups are answered for the same person the login procedure returns.
// `row` is the user the login procedure returns, null for no row, or a
// function standing in for the procedure itself (unknownUsername).
const login = (row, credentials, door = EMPLOYEE_DOOR, { failed = NOT_LOCKED } = {}) => {
  const procedureAnswers = typeof row === "function";

  const { pool, calls } = fakePool({
    [LOGIN]: procedureAnswers ? row : row ? [row] : [],
    [BY_ID]: row && !procedureAnswers ? [byIdRow(row)] : [],
    [EMPLOYERS]: [COFORGE],
    [FAILED]: failed,
    [SUCCEEDED]: [],
  });

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

  // Neither login route has a body validator, so the JSON arrives as sent.
  // bcrypt.compare throws on anything that is not a string, which answered 500.
  const NOT_TEXT = [12345678, ["SecurePass@123"], { a: 1 }, true];

  for (const field of ["password", "username"])
    test(`a ${field} that is not text is 400, and nothing is looked up`, async () => {
      for (const value of NOT_TEXT) {
        const { calls, result } = login(employeeRow(), { ...good, [field]: value });

        await assert.rejects(
          () => result,
          (error) => error.statusCode === 400 && /All fields required/.test(error.message),
          JSON.stringify(value),
        );
        assert.equal(callTo(calls, LOGIN), undefined, JSON.stringify(value));
      }
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
  //
  // This test used to answer the unknown user with an empty result, which the
  // real procedure never returns, and passed while the real answers differed
  // by one letter. It now uses what the procedure does.
  for (const [shape, answer] of [
    ["50037, as the procedure throws it", unknownUsername()],
    ["50037 one level down", unknownUsername(true)],
    ["no row at all", null],
  ])
    test(`an unknown user (${shape}) and a wrong password are indistinguishable`, async () => {
      const unknown = await login(answer, good).result.catch((error) => error);
      const wrong = await login(employeeRow(), { ...good, password: "WrongPass@123" }).result.catch(
        (error) => error,
      );

      assert.equal(unknown.message, wrong.message);
      assert.equal(unknown.statusCode, wrong.statusCode);
    });

  // The other half: the time. Without a compare, an unknown username answered
  // about 70ms sooner than a wrong password, which can be measured from
  // outside. Timing itself is too noisy to assert, so what is asserted is that
  // the same work happens: one compare, against a hash of the production cost.
  test("an unknown user costs the same bcrypt work as a wrong password", async (t) => {
    const compare = t.mock.method(bcrypt, "compare");

    await login(unknownUsername(), good).result.catch(() => {});

    assert.equal(compare.mock.callCount(), 1, "no bcrypt compare for an unknown username");
    assert.match(compare.mock.calls[0].arguments[1], /^\$2b\$10\$/, "not a cost-10 hash");
  });

  // authService catches 50037 itself now. The map entry is for any other caller
  // of the login procedure, and its small c was the original leak.
  test("the error map answers 50037 exactly as a wrong password is answered", async () => {
    const { sqlErrorMap } = await import("../../src/utils/sqlErrorMap.js");
    const wrong = await login(employeeRow(), { ...good, password: "WrongPass@123" }).result.catch(
      (error) => error,
    );

    assert.equal(sqlErrorMap[50037].message, wrong.message);
    assert.equal(sqlErrorMap[50037].statusCode, wrong.statusCode);
  });

  test("an unknown user records nothing", async () => {
    const { calls, result } = login(unknownUsername(), good);
    await result.catch(() => {});

    assert.equal(callTo(calls, FAILED), undefined);
    assert.equal(callTo(calls, SUCCEEDED), undefined);
  });

  // Only 50037 means "no such user". Anything else, a deadlock or a dropped
  // connection, is a real failure and must not be dressed up as a wrong
  // password.
  test("any other failure of the login procedure is passed on", async () => {
    const deadlock = () => {
      const error = new Error("deadlock");
      error.number = 1205;
      throw error;
    };

    await assert.rejects(
      () => login(deadlock, good).result,
      (error) => error.number === 1205 && error.statusCode === undefined,
    );
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
  // recording as a sign-in. The failed count resets when the change succeeds.
  test("does not record a last login", async () => {
    const { calls, result } = login(mustChange(), good);
    await result;

    assert.equal(
      callTo(calls, SUCCEEDED),
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
    // The version verifySession checks on every request, from the row the
    // password was checked against.
    assert.equal(claims.token_version, 4);
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

  // sec.us01_usp_login_succeeded records the login and clears the failed
  // count, so a person who got their password right is not still carrying the
  // failures from before.
  test("records the login, and clears the failed count, for the account that signed in", async () => {
    const { calls, result } = login(employeeRow(), good);
    await result;

    const recorded = callTo(calls, SUCCEEDED);

    assert.ok(recorded, "the successful sign-in was not recorded");
    assert.equal(recorded.inputs.us01_user_id, 12);
    assert.equal(callTo(calls, FAILED), undefined);
  });

  test("looks the user up by the username it was given", async () => {
    const { calls, result } = login(employeeRow(), good);
    await result;

    assert.equal(inputsFor(calls, LOGIN).us01_username, "EMP-020");
  });
});

// GET /auth/me, added 2026-09-23. The session cookie is httpOnly, so this is
// the frontend's only way to know who is signed in after a reload.
const PROFILE_FIELDS = [
  "user_id",
  "username",
  "role_id",
  "role_name",
  "first_name",
  "middle_name",
  "last_name",
  "email_address",
  "client_id",
  "employers",
];

const whoIs = (session, answers) => {
  const { pool, calls } = fakePool(answers);
  return { calls, result: AuthService.currentUser(pool, session) };
};

const hrSession = { user_id: 3, role_name: ADMIN };
const employeeSession = { user_id: 12, role_name: EMPLOYEE };

// A procedure THROW as mssql delivers it. The number can sit on the error or
// one level down, CLAUDE.md §5, so both are tried.
const sqlThrow = (number, nested) => () => {
  const error = new Error("user is inactive");
  if (nested) error.originalError = { number };
  else error.number = number;
  throw error;
};

describe("authService — who is signed in", () => {
  test("answers with the named fields and nothing else", async () => {
    const { result } = whoIs(hrSession, {
      [BY_ID]: [byIdRow(hrRow())],
      [EMPLOYERS]: [COFORGE],
    });

    const user = await result;

    assert.deepEqual(Object.keys(user).sort(), [...PROFILE_FIELDS].sort());
    assert.deepEqual(user, {
      user_id: 3,
      username: "hr.coforge",
      role_id: 2,
      role_name: ADMIN,
      first_name: "Maria",
      middle_name: "",
      last_name: "Reyes",
      email_address: "hr@coforge.example.com",
      client_id: null,
      employers: [COFORGE],
    });
  });

  // The procedure returns the hash with everything else. This is the test that
  // fails if the answer is ever built by spreading the row.
  test("never carries the password hash, under any name", async () => {
    const { result } = whoIs(employeeSession, { [BY_ID]: [byIdRow(employeeRow())] });
    const serialised = JSON.stringify(await result);

    assert.doesNotMatch(serialised, /password/i);
    assert.ok(!serialised.includes(HASH), "the hash itself is in the answer");
  });

  test("gives an HR their company, looked up for their own id", async () => {
    const { calls, result } = whoIs(hrSession, {
      [BY_ID]: [byIdRow(hrRow())],
      [EMPLOYERS]: [{ ...COFORGE, some_column_added_later: "x" }],
    });

    const user = await result;

    assert.deepEqual(user.employers, [COFORGE], "a column the procedure gains leaks through");
    assert.equal(inputsFor(calls, EMPLOYERS).us01_user_id, 3);
  });

  test("gives an employee their client id, and does not ask about employers", async () => {
    const { calls, result } = whoIs(employeeSession, { [BY_ID]: [byIdRow(employeeRow())] });

    const user = await result;

    assert.equal(user.client_id, 98);
    assert.deepEqual(user.employers, []);
    assert.equal(callTo(calls, EMPLOYERS), undefined);
  });

  test("reads the user the token names, not one it was told about elsewhere", async () => {
    const { calls, result } = whoIs(employeeSession, { [BY_ID]: [byIdRow(employeeRow())] });
    await result;

    assert.equal(inputsFor(calls, BY_ID).us01_user_id, 12);
  });
});

describe("authService — who is signed in, when the session should be over", () => {
  // 50038 is the procedure's answer for an inactive or missing user. It is
  // mapped to 403 for the endpoints that reach it; here it has to be 401, which
  // is what tells the frontend to go back to the sign-in page.
  for (const nested of [false, true])
    test(`a closed account is 401${nested ? " (number one level down)" : ""}`, async () => {
      const { result } = whoIs(employeeSession, { [BY_ID]: sqlThrow(50038, nested) });

      await assert.rejects(result, (error) =>
        error.statusCode === 401 && /no longer active/.test(error.message),
      );
    });

  test("a locked account is 401", async () => {
    const { result } = whoIs(employeeSession, {
      [BY_ID]: [byIdRow(employeeRow({ us01_is_locked: true }))],
    });

    await assert.rejects(result, (error) => error.statusCode === 401);
  });

  // The procedure INNER JOINs an active role, so a withdrawn role is no row.
  test("a user whose role was withdrawn is 401", async () => {
    const { result } = whoIs(employeeSession, { [BY_ID]: [] });

    await assert.rejects(result, (error) =>
      error.statusCode === 401 && /session has ended/.test(error.message),
    );
  });

  test("a role changed since the token was signed is 401", async () => {
    // The token says HR; the database now says Administrator.
    const { result } = whoIs(hrSession, {
      [BY_ID]: [byIdRow(hrRow({ us02_role_id: 1, us02_role_name: SUPER_ADMIN }))],
    });

    await assert.rejects(result, (error) => error.statusCode === 401);
  });

  // The controller clears the cookie on a 401. A database that is down must
  // not become a 401, or one outage would sign every user out.
  test("any other database failure is passed on, not turned into a 401", async () => {
    const { result } = whoIs(employeeSession, { [BY_ID]: sqlThrow(1205, false) });

    await assert.rejects(result, (error) => error.statusCode === undefined && error.number === 1205);
  });
});

describe("authService — the login answers with the same profile", () => {
  test("a successful login carries exactly what GET /auth/me would", async () => {
    const { result } = login(hrRow(), { ...good, username: "hr.coforge" }, ADMIN_DOOR);
    const { user } = await result;

    const me = await whoIs(hrSession, {
      [BY_ID]: [byIdRow(hrRow())],
      [EMPLOYERS]: [COFORGE],
    }).result;

    assert.deepEqual(user, me);
  });

  // No session on this path, so nothing to describe. The frontend routes to
  // the change-password screen on `mustChangePassword` alone.
  test("the forced password change carries no profile and does not look one up", async () => {
    const { calls, result } = login(employeeRow({ us01_must_change_password: true }), good);
    const answer = await result;

    assert.equal(answer.user, undefined);
    assert.equal(callTo(calls, BY_ID), undefined);
  });

  test("a profile that cannot be read issues no token and records no login", async () => {
    const { pool, calls } = fakePool({
      [LOGIN]: [employeeRow()],
      [BY_ID]: [],
      [EMPLOYERS]: [],
    });

    await assert.rejects(
      AuthService.login(pool, { ...EMPLOYEE_DOOR, ...good }),
      (error) => error.statusCode === 401,
    );
    assert.equal(callTo(calls, SUCCEEDED), undefined);
  });
});

// Session revocation, DBA request 18. verifyToken calls this on every
// authenticated request.
describe("authService — verifySession", () => {
  const live = { user_id: 12, role_name: EMPLOYEE, token_version: 4 };

  // `byId` is the row sec.us01_usp_sel_user_by_id returns, or a function
  // standing in for the procedure (sqlThrow).
  const check = (session, byId = employeeRow()) => {
    const answer = typeof byId === "function" ? byId : [byIdRow(byId)];
    const { pool } = fakePool({ [BY_ID]: answer });

    return AuthService.verifySession(pool, session);
  };

  test("a token signed with the current version passes", async () => {
    const user = await check(live);

    assert.equal(user.us01_user_id, 12);
  });

  // The whole point: logout, a password change or a credential reset raised
  // the version, and the token signed before it stops here.
  test("a token signed with an older version is refused with 401", async () => {
    await assert.rejects(
      () => check({ ...live, token_version: 3 }),
      (error) => error.statusCode === 401 && /session has ended/.test(error.message),
    );
  });

  // Signed before this branch. Every session in place on deploy day ends once.
  test("a token with no version at all is refused", async () => {
    const { token_version, ...unversioned } = live;

    await assert.rejects(() => check(unversioned), (error) => error.statusCode === 401);
  });

  // A reset token in the session cookie: no role, no version.
  test("a reset token is not a session", async () => {
    await assert.rejects(
      () => check({ user_id: 12, username: "EMP-020", purpose: "password_reset" }),
      (error) => error.statusCode === 401,
    );
  });

  // The account checks GET /auth/me already made now apply to every request.
  test("a closed, locked or re-roled account is refused even with the right version", async () => {
    for (const row of [
      employeeRow({ us01_is_active: false }),
      employeeRow({ us01_is_locked: true }),
      employeeRow({ us02_role_name: ADMIN, us02_role_id: 2 }),
    ])
      await assert.rejects(() => check(live, row), (error) => error.statusCode === 401);
  });

  // The temporary lockout does not end sessions, or anybody could sign out any
  // employee with eight wrong passwords. lock_seconds_remaining is not even
  // read here.
  test("the temporary lockout does not end a live session", async () => {
    const user = await check(live, employeeRow({ lock_seconds_remaining: 900 }));

    assert.equal(user.us01_user_id, 12);
  });

  test("a database failure is passed on, not turned into a 401", async () => {
    await assert.rejects(
      () => check(live, sqlThrow(1205, false)),
      (error) => error.statusCode === undefined && error.number === 1205,
    );
  });
});

describe("authService — logout", () => {
  const END_SESSIONS = "sec.us01_usp_end_sessions";

  const signed = (claims, options = { expiresIn: 3600 }) =>
    jwt.sign(
      { user_id: 12, username: "EMP-020", role_id: 3, role_name: EMPLOYEE, ...claims },
      config.jwtSecret,
      options,
    );

  const logout = (token, byId = [byIdRow(employeeRow())]) => {
    const { pool, calls } = fakePool({ [BY_ID]: byId, [END_SESSIONS]: [] });
    return { calls, result: AuthService.logout(pool, token) };
  };

  test("a live session ends every session its user has", async () => {
    const { calls, result } = logout(signed({ token_version: 4 }));
    await result;

    assert.equal(inputsFor(calls, END_SESSIONS)?.us01_user_id, 12);
  });

  // A revoked token still verifies as a JWT for up to thirty days. If it could
  // raise the version, whoever held it could sign its owner out of every new
  // session, again and again.
  test("a stale token ends nothing", async () => {
    const { calls, result } = logout(signed({ token_version: 3 }));
    await result;

    assert.equal(callTo(calls, END_SESSIONS), undefined);
  });

  test("a token from before versions, or a reset token, ends nothing", async () => {
    for (const token of [
      signed({}),
      jwt.sign({ user_id: 12, username: "EMP-020", purpose: "password_reset" }, config.jwtSecret),
    ]) {
      const { calls, result } = logout(token);
      await result;

      assert.equal(callTo(calls, END_SESSIONS), undefined);
    }
  });

  test("a closed account ends nothing, and the logout still succeeds", async () => {
    const { calls, result } = logout(signed({ token_version: 4 }), sqlThrow(50038, false));

    await assert.doesNotReject(() => result);
    assert.equal(callTo(calls, END_SESSIONS), undefined);
  });

  // Nothing worth asking the database about.
  test("a forged or expired token never reaches the database", async () => {
    for (const token of [
      jwt.sign({ user_id: 12, token_version: 4 }, "not-the-secret-not-the-secret-not"),
      signed({ token_version: 4 }, { expiresIn: -10 }),
      "not-a-jwt",
    ]) {
      const { calls, result } = logout(token);
      await result;

      assert.deepEqual(calls, [], token.slice(0, 20));
    }
  });

  test("a database failure is passed on", async () => {
    const { result } = logout(signed({ token_version: 4 }), sqlThrow(1205, false));

    await assert.rejects(result, (error) => error.number === 1205);
  });
});

// DBA request 18, agreed 2026-10-06: eight wrong passwords lock the account for
// fifteen minutes, and the lock is checked before the password.
describe("authService — the lockout", () => {
  const locked = (seconds) => employeeRow({ lock_seconds_remaining: seconds });

  // The test that matters most here. Checked after the password, a locked
  // account would still tell a caller which guess was right, and the lock would
  // slow nothing down.
  test("a locked account is refused even with the RIGHT password", async () => {
    const { calls, result } = login(locked(900), good);

    await assert.rejects(
      () => result,
      (error) => error.statusCode === 429 && /Try again in 15 minutes/.test(error.message),
    );
    assert.equal(callTo(calls, SUCCEEDED), undefined, "a locked account was signed in");
  });

  // A wrong password while locked does not add to the count, so the lock is
  // not extended by somebody still guessing.
  test("a locked account records nothing, whatever the password", async () => {
    for (const password of [PASSWORD, "WrongPass@123"]) {
      const { calls, result } = login(locked(900), { ...good, password });

      await assert.rejects(() => result, (error) => error.statusCode === 429);
      assert.equal(callTo(calls, FAILED), undefined, password);
      assert.equal(callTo(calls, SUCCEEDED), undefined, password);
    }
  });

  // The thresholds, pinned as the literals that were agreed.
  test("a wrong password is recorded against the account, with 8 attempts and 15 minutes", async () => {
    const { calls, result } = login(employeeRow(), { ...good, password: "WrongPass@123" });
    await result.catch(() => {});

    assert.deepEqual(inputsFor(calls, FAILED), {
      us01_user_id: 12,
      max_attempts: 8,
      lock_minutes: 15,
    });
  });

  test("a wrong password below the limit is still the uniform 401", async () => {
    await assert.rejects(
      () => login(employeeRow(), { ...good, password: "WrongPass@123" }).result,
      (error) => error.statusCode === 401 && error.message === "Invalid Credentials",
    );
  });

  // The attempt that locks the account says so.
  test("the wrong password that reaches the limit answers 429", async () => {
    const { result } = login(
      employeeRow(),
      { ...good, password: "WrongPass@123" },
      EMPLOYEE_DOOR,
      { failed: [{ us01_failed_login_attempts: 8, lock_seconds_remaining: 900 }] },
    );

    await assert.rejects(
      () => result,
      (error) => error.statusCode === 429 && /Try again in 15 minutes/.test(error.message),
    );
  });

  test("the minutes are rounded up, and never say 0", async () => {
    for (const [seconds, phrase] of [
      [1, "1 minute."],
      [60, "1 minute."],
      [61, "2 minutes."],
      [899, "15 minutes."],
    ]) {
      const error = await login(locked(seconds), good).result.catch((caught) => caught);

      assert.ok(error.message.endsWith(phrase), `${seconds}s: ${error.message}`);
    }
  });

  // Only an account that exists can be locked.
  test("an unknown username records nothing", async () => {
    const { calls, result } = login(null, good);
    await result.catch(() => {});

    assert.equal(callTo(calls, FAILED), undefined);
  });

  // The right password on a closed account is still a refusal, and not a
  // sign-in worth recording.
  test("a closed account with the right password does not clear the count", async () => {
    const { calls, result } = login(employeeRow({ us01_is_active: false }), good);
    await result.catch(() => {});

    assert.equal(callTo(calls, SUCCEEDED), undefined);
  });

  // Both doors share this, so the lock is per account, not per door.
  test("the admin door locks the same way", async () => {
    const { result } = login(
      hrRow({ lock_seconds_remaining: 300 }),
      { ...good, username: "hr.coforge" },
      ADMIN_DOOR,
    );

    await assert.rejects(
      () => result,
      (error) => error.statusCode === 429 && /5 minutes/.test(error.message),
    );
  });
});
