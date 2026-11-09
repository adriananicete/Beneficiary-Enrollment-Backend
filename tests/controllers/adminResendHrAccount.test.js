import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";
import { callTo, fakePool } from "../helpers/fakePool.js";

const { refuseHrAccount } = await import("../../src/controllers/adminController.js");

// "Resend credentials" for an employee finds the account by the employee's client record. For an HR person who
// enrolled themselves that is their HR account, and resending would reset its password and email a temporary one. It
// is refused: they sign in at the employee login with their HR username and password.

const BY_ID = "sec.us01_usp_sel_user_by_id";
const account = (role) => ({ us01_user_id: "10117", us01_username: "hr.phillife.2", us02_role_name: role, client_id: "501" });

describe("refuseHrAccount", () => {
  test("an HR account is refused with a 409 that says where the password is reissued", async () => {
    const { pool } = fakePool({ [BY_ID]: [account("HR")] });

    await assert.rejects(
      () => refuseHrAccount(pool, { us01_user_id: "10117" }),
      (error) => error.statusCode === 409 && /signs in with their HR account/.test(error.message) && /company's page/.test(error.message),
    );
  });

  test("an employee's account goes on, as it always did", async () => {
    const { pool } = fakePool({ [BY_ID]: [account("Employee")] });

    await refuseHrAccount(pool, { us01_user_id: "12" });
  });

  test("looks the account up by the id it was given", async () => {
    const { pool, calls } = fakePool({ [BY_ID]: [account("Employee")] });

    await refuseHrAccount(pool, { us01_user_id: "12" });

    assert.equal(callTo(calls, BY_ID).inputs.us01_user_id, "12");
  });

  test("an account that cannot be read is not guessed to be HR", async () => {
    const { pool } = fakePool({ [BY_ID]: [] });

    await refuseHrAccount(pool, { us01_user_id: "12" });
  });
});
