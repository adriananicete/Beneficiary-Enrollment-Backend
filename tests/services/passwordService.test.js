import { describe, test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcrypt";

import "../helpers/env.js";
import { fakePool, inputsFor, queryMatching } from "../helpers/fakePool.js";

const { default: PasswordService } = await import(
  "../../src/services/passwordService.js"
);
const { EMPLOYEE, ADMIN, SUPER_ADMIN } = await import(
  "../../src/utils/constants.js"
);

// The forced password change, reached from both logins. It has taken a pool as
// its first argument since it was written, so it has been testable this whole
// time and simply had no test — while holding the password policy, the
// closed-account guard, the role separation behind both doors, and the two
// values that decide whether a password is stored as a hash or in the clear.
//
// It is also the service above the procedure that broke on 2026-09-08. The
// model beneath it gained tests that day; this did not.
//
// Cost 4 rather than the production 10. The cost lives in the hash, so compare
// behaves identically.
const OLD_PASSWORD = "OldPass@123";
const NEW_PASSWORD = "NewPass@456";
const STORED_HASH = bcrypt.hashSync(OLD_PASSWORD, 4);

const LOGIN = "sec.us01_usp_login";
const CHANGE = "sec.us01_usp_first_login";

const userRow = (overrides = {}) => ({
  us01_user_id: 12,
  us01_username: "EMP-020",
  us01_password: STORED_HASH,
  us01_is_active: true,
  us01_is_locked: false,
  us02_role_id: 3,
  us02_role_name: EMPLOYEE,
  ...overrides,
});

const change = (row, fields = {}, allowedRoles = [EMPLOYEE]) => {
  const { pool, calls } = fakePool({
    [LOGIN]: row ? [row] : [],
    [CHANGE]: [],
  });

  return {
    calls,
    result: PasswordService.changePassword(pool, {
      username: "EMP-020",
      oldPassword: OLD_PASSWORD,
      newPassword: NEW_PASSWORD,
      allowedRoles,
      ...fields,
    }),
  };
};

describe("passwordService — refusing", () => {
  for (const missing of ["oldPassword", "newPassword"]) {
    test(`a missing ${missing} is 400`, async () => {
      await assert.rejects(
        () => change(userRow(), { [missing]: undefined }).result,
        (error) => error.statusCode === 400 && /All fields required/.test(error.message),
      );
    });
  }

  test("an unknown username is refused", async () => {
    await assert.rejects(
      () => change(null).result,
      (error) => error.statusCode === 400 && /Invalid Credentials/.test(error.message),
    );
  });

  test("a wrong old password is refused", async () => {
    await assert.rejects(
      () => change(userRow(), { oldPassword: "NotTheOne@1" }).result,
      (error) => error.statusCode === 400,
    );
  });

  // Uniform, so this endpoint cannot be used to work out which usernames exist.
  // It matters more here than at the login: this route is reachable with a
  // reset token rather than a session.
  test("an unknown user and a wrong password are indistinguishable", async () => {
    const unknown = await change(null).result.catch((error) => error);
    const wrong = await change(userRow(), { oldPassword: "NotTheOne@1" }).result.catch(
      (error) => error,
    );

    assert.equal(unknown.message, wrong.message);
    assert.equal(unknown.statusCode, wrong.statusCode);
  });

  // A reset token issued before the account was closed stays valid for its full
  // fifteen minutes, so this path needs the same guard as the login rather than
  // trusting that the login already ran one.
  test("a closed account is refused even with the right password", async () => {
    await assert.rejects(
      () => change(userRow({ us01_is_active: false })).result,
      (error) => error.statusCode === 403 && /no longer active/.test(error.message),
    );
  });

  test("a locked account is refused", async () => {
    await assert.rejects(
      () => change(userRow({ us01_is_locked: true })).result,
      (error) => error.statusCode === 403,
    );
  });

  // The same ordering the two logins use, and for the same reason: only
  // somebody who has already proved the password learns that the account exists
  // but is closed.
  test("a closed account with the WRONG password is 400, not 403", async () => {
    await assert.rejects(
      () =>
        change(userRow({ us01_is_active: false }), { oldPassword: "NotTheOne@1" }).result,
      (error) => error.statusCode === 400,
    );
  });

  // allowedRoles mirrors the middleware of the same name. Both logins guard
  // their own role and this is the door behind both of them; a rule enforced on
  // one side and not the other stops being a rule.
  test("an employee cannot spend their token on the admin endpoint", async () => {
    await assert.rejects(
      () => change(userRow(), {}, [SUPER_ADMIN, ADMIN]).result,
      (error) =>
        error.statusCode === 403 && /own sign-in page/.test(error.message),
    );
  });

  test("an HR cannot spend theirs on the employee endpoint", async () => {
    await assert.rejects(
      () => change(userRow({ us02_role_name: ADMIN }), {}, [EMPLOYEE]).result,
      (error) => error.statusCode === 403,
    );
  });

  test("the wrong door with a wrong password is 400, not 403", async () => {
    await assert.rejects(
      () =>
        change(userRow(), { oldPassword: "NotTheOne@1" }, [SUPER_ADMIN, ADMIN]).result,
      (error) => error.statusCode === 400,
    );
  });

  test("the new password cannot be the old one", async () => {
    await assert.rejects(
      () => change(userRow(), { newPassword: OLD_PASSWORD }).result,
      (error) => error.statusCode === 400 && /same as the old password/.test(error.message),
    );
  });

  test("nothing is written when a guard refuses", async () => {
    const { calls, result } = change(userRow({ us01_is_locked: true }));
    await result.catch(() => {});

    assert.ok(
      !calls.some((call) => call.procedure === CHANGE),
      "the change procedure ran for a refused request",
    );
    assert.equal(queryMatching(calls, /us01_last_login/), undefined);
  });
});

describe("passwordService — the password policy", () => {
  // Eight characters, at least one letter and at least one digit. Pinned as
  // literals rather than against the regex, so changing the rule has to change
  // these too.
  for (const [label, password] of [
    ["too short", "Ab1"],
    ["seven characters", "Abcdef1"],
    ["no digit at all", "Abcdefghi"],
    ["no letter at all", "12345678"],
  ]) {
    test(`refuses a new password that is ${label}`, async () => {
      await assert.rejects(
        () => change(userRow(), { newPassword: password }).result,
        (error) =>
          error.statusCode === 400 && /at least 8 characters/.test(error.message),
      );
    });
  }

  for (const [label, password] of [
    ["exactly eight with both", "Abcdefg1"],
    ["long with symbols", "NewPass@456"],
    ["digits and letters only", "abcd1234"],
  ]) {
    test(`accepts a new password that is ${label}`, async () => {
      const { result } = change(userRow(), { newPassword: password });

      await assert.doesNotReject(() => result);
    });
  }
});

describe("passwordService — what reaches the database", () => {
  // Load-bearing and easy to get wrong in the direction that stores a password
  // in the clear. The procedure is handed a hash of the new password, never the
  // characters the employee typed.
  test("sends a bcrypt hash of the new password, never the plaintext", async () => {
    const { calls, result } = change(userRow());
    await result;

    const { newpass } = inputsFor(calls, CHANGE);

    assert.notEqual(newpass, NEW_PASSWORD);
    assert.match(newpass, /^\$2[aby]\$/);
    assert.ok(
      await bcrypt.compare(NEW_PASSWORD, newpass),
      "the stored hash does not verify against the new password",
    );
  });

  // The procedure compares hashes, so oldpass has to be the stored hash rather
  // than what the caller typed. The real verification is the bcrypt.compare
  // above it. Sending the plaintext here would make the procedure's own check
  // match nothing and refuse every change with 50033.
  test("sends the stored hash as oldpass, not what the caller typed", async () => {
    const { calls, result } = change(userRow());
    await result;

    const { oldpass } = inputsFor(calls, CHANGE);

    assert.equal(oldpass, STORED_HASH);
    assert.notEqual(oldpass, OLD_PASSWORD);
  });

  test("changes the password for the username it was given", async () => {
    const { calls, result } = change(userRow());
    await result;

    assert.equal(inputsFor(calls, CHANGE).us01_username, "EMP-020");
    assert.equal(inputsFor(calls, LOGIN).us01_username, "EMP-020");
  });

  test("records the last login once the change has gone through", async () => {
    const { calls, result } = change(userRow());
    await result;

    const recorded = queryMatching(calls, /us01_last_login/);

    assert.ok(recorded, "no last login was recorded");
    assert.equal(recorded.inputs.us01_username, "EMP-020");
  });

  // The role is read from the user row rather than carried in the reset token.
  // The row is already being fetched to check the password, so the check costs
  // nothing, and a role that changed inside the token's fifteen minutes
  // resolves the database's way rather than the way it looked when the token
  // was minted.
  test("reads the role from the database, not from the caller", async () => {
    await assert.rejects(
      () => change(userRow({ us02_role_name: ADMIN }), {}, [EMPLOYEE]).result,
      (error) => error.statusCode === 403,
    );
  });
});
