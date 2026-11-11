import { describe, test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

import "../helpers/env.js";
import { fakePool } from "../helpers/fakePool.js";

const { default: AuthService } = await import("../../src/services/authService.js");
const { default: PasswordService } = await import("../../src/services/passwordService.js");
const { default: config } = await import("../../src/config/env.js");
const { EMPLOYEE, ADMIN, SUPER_ADMIN } = await import("../../src/utils/constants.js");

// Which security event each sign-in, logout and password change records (DBA
// request 28), and that none of them carries a password, a hash or a token.
// The services take a `record` function; these tests hand in one that keeps
// what it is given.

const PASSWORD = "SecurePass@123";
const HASH = bcrypt.hashSync(PASSWORD, 4);

const LOGIN = "sec.us01_usp_login";
const BY_ID = "sec.us01_usp_sel_user_by_id";
const EMPLOYERS = "sec.us08_usp_sel_employers_by_user";
const FAILED = "sec.us01_usp_login_failed";
const SUCCEEDED = "sec.us01_usp_login_succeeded";
const CHANGE = "sec.us01_usp_first_login";
const END_SESSIONS = "sec.us01_usp_end_sessions";

const NOT_LOCKED = [{ us01_failed_login_attempts: 1, lock_seconds_remaining: 0 }];
const NOW_LOCKED = [{ us01_failed_login_attempts: 8, lock_seconds_remaining: 900 }];

const row = (overrides = {}) => ({
  us01_user_id: 12,
  us01_username: "EMP-020",
  us01_password: HASH,
  us01_first_name: "Juan",
  us01_last_name: "Dela Cruz",
  us01_email_address: "juan@example.com",
  us01_is_active: true,
  us01_is_locked: false,
  lock_seconds_remaining: 0,
  us01_token_version: 4,
  us01_must_change_password: false,
  us02_role_id: 3,
  us02_role_name: EMPLOYEE,
  ...overrides,
});

const unknownUsername = () => {
  const error = new Error("Invalid username or password.");
  error.number = 50037;
  throw error;
};

const recorder = () => {
  const events = [];
  const record = (event) => events.push(event);
  record.events = events;
  return record;
};

const EMPLOYEE_DOOR = { allowedRoles: [EMPLOYEE], wrongDoorMessage: "Admin and HR must use the admin login" };
const ADMIN_DOOR = { allowedRoles: [SUPER_ADMIN, ADMIN], wrongDoorMessage: "Employees must use the employee login" };

// The events of one sign-in, whether it succeeded or not.
const signIn = async (user, { username = "EMP-020", password = PASSWORD, door = EMPLOYEE_DOOR, failed = NOT_LOCKED } = {}) => {
  const { pool } = fakePool({
    [LOGIN]: typeof user === "function" ? user : [user],
    [BY_ID]: typeof user === "function" ? [] : [{ ...user, client_id: 98 }],
    [EMPLOYERS]: [],
    [FAILED]: failed,
    [SUCCEEDED]: [],
  });
  const record = recorder();

  await AuthService.login(pool, { ...door, username, password, record }).catch(() => {});

  return record.events;
};

// Nothing secret in any event, whatever the path.
const assertNothingSecret = (events) => {
  const text = JSON.stringify(events);

  for (const secret of [PASSWORD, HASH, "WrongPass@123", "token"]) assert.ok(!text.includes(secret), `an event carries ${secret}`);
};

describe("the security events of a sign-in", () => {
  test("a successful sign-in is LOGIN_SUCCEEDED, with the account and the username typed", async () => {
    const events = await signIn(row(), { username: "emp-020" });

    assert.deepEqual(events, [{ type: "LOGIN_SUCCEEDED", userId: 12, username: "emp-020" }]);
  });

  test("a first sign-in that must change its password is LOGIN_SUCCEEDED, marked so", async () => {
    const events = await signIn(row({ us01_must_change_password: true }));

    assert.deepEqual(events, [{ type: "LOGIN_SUCCEEDED", userId: 12, username: "EMP-020", detail: "must_change_password" }]);
  });

  test("an unknown username is LOGIN_FAILED with no account", async () => {
    const events = await signIn(unknownUsername, { username: "nobody" });

    assert.deepEqual(events, [{ type: "LOGIN_FAILED", username: "nobody", detail: "unknown_username" }]);
  });

  test("a wrong password is LOGIN_FAILED against the account", async () => {
    const events = await signIn(row(), { password: "WrongPass@123" });

    assert.deepEqual(events, [{ type: "LOGIN_FAILED", userId: 12, username: "EMP-020", detail: "wrong_password" }]);
  });

  test("the wrong password that locks is LOGIN_FAILED, then ACCOUNT_LOCKED", async () => {
    const events = await signIn(row(), { password: "WrongPass@123", failed: NOW_LOCKED });

    assert.deepEqual(
      events.map((event) => event.type),
      ["LOGIN_FAILED", "ACCOUNT_LOCKED"],
    );
    assert.deepEqual(events[1], { type: "ACCOUNT_LOCKED", userId: 12, username: "EMP-020" });
  });

  test("a sign-in while locked is LOGIN_WHILE_LOCKED, right password or wrong", async () => {
    for (const password of [PASSWORD, "WrongPass@123"]) {
      const events = await signIn(row({ lock_seconds_remaining: 900 }), { password });

      assert.deepEqual(events, [{ type: "LOGIN_WHILE_LOCKED", userId: 12, username: "EMP-020" }], password);
    }
  });

  test("a closed account with the right password is LOGIN_FAILED, account_closed", async () => {
    for (const closed of [{ us01_is_active: false }, { us01_is_locked: true }]) {
      const events = await signIn(row(closed));

      assert.deepEqual(events, [{ type: "LOGIN_FAILED", userId: 12, username: "EMP-020", detail: "account_closed" }]);
    }
  });

  test("the wrong login page for the role is LOGIN_FAILED, wrong_door", async () => {
    const events = await signIn(row(), { door: ADMIN_DOOR });

    assert.deepEqual(events, [{ type: "LOGIN_FAILED", userId: 12, username: "EMP-020", detail: "wrong_door" }]);
  });

  test("a request with a field missing is not a sign-in and records nothing", async () => {
    assert.deepEqual(await signIn(row(), { password: "" }), []);
    assert.deepEqual(await signIn(row(), { username: "" }), []);
  });

  test("no event carries a password, a hash or a token", async () => {
    const all = [
      ...(await signIn(row())),
      ...(await signIn(row({ us01_must_change_password: true }))),
      ...(await signIn(row(), { password: "WrongPass@123", failed: NOW_LOCKED })),
      ...(await signIn(unknownUsername, { password: "WrongPass@123" })),
    ];

    assertNothingSecret(all);
  });

  test("with no recorder, a sign-in works as before", async () => {
    const { pool } = fakePool({ [LOGIN]: [row()], [BY_ID]: [row()], [EMPLOYERS]: [], [SUCCEEDED]: [] });
    const result = await AuthService.login(pool, { ...EMPLOYEE_DOOR, username: "EMP-020", password: PASSWORD });

    assert.equal(result.mustChangePassword, false);
  });
});

describe("the security event of a logout", () => {
  const signed = (claims) =>
    jwt.sign({ user_id: 12, username: "EMP-020", role_id: 3, role_name: EMPLOYEE, ...claims }, config.jwtSecret, { expiresIn: 3600 });

  const logout = async (token) => {
    const { pool } = fakePool({ [BY_ID]: [{ ...row(), client_id: 98 }], [END_SESSIONS]: [] });
    const record = recorder();

    await AuthService.logout(pool, token, record);

    return record.events;
  };

  test("a live session's logout is LOGOUT, with the account", async () => {
    assert.deepEqual(await logout(signed({ token_version: 4 })), [{ type: "LOGOUT", userId: 12, username: "EMP-020" }]);
  });

  test("a stale or forged token ends nothing and records nothing", async () => {
    assert.deepEqual(await logout(signed({ token_version: 3 })), []);
    assert.deepEqual(await logout("not-a-token"), []);
  });
});

describe("the security events of a password change", () => {
  const OLD = "OldPass@123";
  const NEW = "NewPass@456";
  const OLD_HASH = bcrypt.hashSync(OLD, 4);

  const change = async (user, { oldPassword = OLD, newPassword = NEW, allowedRoles = [EMPLOYEE] } = {}) => {
    const { pool } = fakePool({ [LOGIN]: user ? [user] : [], [CHANGE]: [], [SUCCEEDED]: [], [END_SESSIONS]: [] });
    const record = recorder();

    await PasswordService.changePassword(pool, { username: "EMP-020", oldPassword, newPassword, allowedRoles, record }).catch(() => {});

    return record.events;
  };

  const resetRow = (overrides = {}) => row({ us01_password: OLD_HASH, us01_must_change_password: true, ...overrides });

  test("a change that goes through is PASSWORD_CHANGED", async () => {
    assert.deepEqual(await change(resetRow()), [{ type: "PASSWORD_CHANGED", userId: 12, username: "EMP-020" }]);
  });

  test("a spent reset token is RESET_TOKEN_REUSED", async () => {
    assert.deepEqual(await change(resetRow({ us01_must_change_password: false })), [
      { type: "RESET_TOKEN_REUSED", userId: 12, username: "EMP-020" },
    ]);
  });

  test("a wrong current password is PASSWORD_CHANGE_FAILED, wrong_password", async () => {
    assert.deepEqual(await change(resetRow(), { oldPassword: "Wrong@123" }), [
      { type: "PASSWORD_CHANGE_FAILED", userId: 12, username: "EMP-020", detail: "wrong_password" },
    ]);
  });

  test("a closed account is PASSWORD_CHANGE_FAILED, account_closed", async () => {
    assert.deepEqual(await change(resetRow({ us01_is_active: false })), [
      { type: "PASSWORD_CHANGE_FAILED", userId: 12, username: "EMP-020", detail: "account_closed" },
    ]);
  });

  test("the wrong page for the role is PASSWORD_CHANGE_FAILED, wrong_door", async () => {
    assert.deepEqual(await change(resetRow(), { allowedRoles: [SUPER_ADMIN, ADMIN] }), [
      { type: "PASSWORD_CHANGE_FAILED", userId: 12, username: "EMP-020", detail: "wrong_door" },
    ]);
  });

  test("an account that is gone is PASSWORD_CHANGE_FAILED, unknown_username", async () => {
    assert.deepEqual(await change(null), [{ type: "PASSWORD_CHANGE_FAILED", username: "EMP-020", detail: "unknown_username" }]);
  });

  test("a new password refused by the policy is a form error, not an event", async () => {
    assert.deepEqual(await change(resetRow(), { newPassword: "short" }), []);
    assert.deepEqual(await change(resetRow(), { newPassword: OLD }), []);
  });

  test("no event carries either password or the hash", async () => {
    const all = [
      ...(await change(resetRow())),
      ...(await change(resetRow(), { oldPassword: "Wrong@123" })),
      ...(await change(resetRow({ us01_must_change_password: false }))),
    ];
    const text = JSON.stringify(all);

    for (const secret of [OLD, NEW, OLD_HASH, "Wrong@123"]) assert.ok(!text.includes(secret), secret);
  });
});
