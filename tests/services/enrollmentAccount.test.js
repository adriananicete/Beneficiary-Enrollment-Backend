import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";
import { callTo, fakePool, inputsFor } from "../helpers/fakePool.js";

const { accountFor } = await import("../../src/services/enrollmentService.js");

// The account an enrollment gives its person. The body of createEnrollment's transaction is not tested (its correctness
// is whether the database agrees), but this decision only needs something that answers request(), so it is: an HR person
// who enrolls themselves is linked to the new client record and given no second account; everyone else is given one.

const LINK = "sec.us01_usp_link_hr_client";
const BY_ID = "sec.us01_usp_sel_user_by_id";
const CREATE_USER = "sec.us01_usp_ins_users";
const ASSIGN_ROLE = "sec.us04_usp_assign_role";

const CLIENT_ID = "501";

const enrollment = (overrides = {}) => ({
  employer_id: "10004",
  email_address: "hr.person@phillife.example",
  employee_id_number: "EMP-0042",
  first_name: "Maria",
  middle_name: "",
  last_name: "Santos",
  ...overrides,
});

// What sec.us01_usp_link_hr_client answers, as tried against the database on 2026-11-06: one row, with the account's id
// when it linked and a NULL id when no HR account of this company has the email.
const linkedTo = (id) => [{ us01_user_id: id }];

const harness = ({ link = linkedTo(null), byId = [] } = {}) =>
  fakePool({
    [LINK]: link,
    [BY_ID]: byId,
    [CREATE_USER]: () => ({ recordset: [], output: { us01_user_id: "9" } }),
    [ASSIGN_ROLE]: [],
  });

const hrAccount = (overrides = {}) => ({ us01_user_id: "10117", us01_username: "hr.phillife.2", client_id: CLIENT_ID, ...overrides });

describe("accountFor — an employee", () => {
  test("is given an Employee account and a temporary password, as before", async () => {
    const { pool, calls } = harness();

    const account = await accountFor(pool, enrollment(), CLIENT_ID);

    assert.equal(account.hrUsername, undefined);
    assert.match(account.tempPassword, /^.{12}$/);

    const user = inputsFor(calls, CREATE_USER);
    assert.equal(user.us01_username, "EMP-0042");
    assert.equal(user.us01_email_address, "hr.person@phillife.example");
    assert.equal(user.client_id, CLIENT_ID);
    assert.equal(user.us01_must_change_password, 1);
    assert.notEqual(user.us01_password, account.tempPassword, "stored hashed");
    assert.equal(inputsFor(calls, ASSIGN_ROLE).us02_role_id, 3);
  });

  test("is not looked up as an account when nobody was linked", async () => {
    const { pool, calls } = harness();

    await accountFor(pool, enrollment(), CLIENT_ID);

    assert.equal(callTo(calls, BY_ID), undefined);
  });

  test("a NULL id in the procedure's one row is nobody", async () => {
    const { pool, calls } = harness({ link: [{ us01_user_id: null }] });

    const account = await accountFor(pool, enrollment(), CLIENT_ID);

    assert.ok(account.tempPassword);
    assert.ok(callTo(calls, CREATE_USER));
  });

  test("an answer with no row at all is nobody too", async () => {
    const { pool } = harness({ link: [] });

    assert.ok((await accountFor(pool, enrollment(), CLIENT_ID)).tempPassword);
  });
});

describe("accountFor — an HR person enrolling themselves", () => {
  test("is linked to the new client record and given no second account", async () => {
    const { pool, calls } = harness({ link: linkedTo("10117"), byId: [hrAccount()] });

    const account = await accountFor(pool, enrollment(), CLIENT_ID);

    assert.deepEqual(account, { hrUsername: "hr.phillife.2" });
    assert.equal(callTo(calls, CREATE_USER), undefined, "no user was created");
    assert.equal(callTo(calls, ASSIGN_ROLE), undefined, "no role was assigned");
  });

  test("the procedure is asked with the client, the invitation's email and company, and 'system'", async () => {
    const { pool, calls } = harness({ link: linkedTo("10117"), byId: [hrAccount()] });

    await accountFor(pool, enrollment({ email_address: "  hr.person@phillife.example  " }), CLIENT_ID);

    const asked = inputsFor(calls, LINK);
    assert.equal(asked.client_id, CLIENT_ID);
    assert.equal(asked.email_address, "hr.person@phillife.example", "trimmed: the procedure does not trim");
    assert.equal(asked.employer_id, "10004");
    assert.equal(asked.linked_by, "system");
  });

  test("reads the account back, as the account the procedure named", async () => {
    const { pool, calls } = harness({ link: linkedTo("10117"), byId: [hrAccount()] });

    await accountFor(pool, enrollment(), CLIENT_ID);

    assert.equal(inputsFor(calls, BY_ID).us01_user_id, "10117");
  });

  test("an HR account already linked to another client record is refused: the procedure keeps the older link", async () => {
    // The procedure answers the account's id here too. Trusted, it would leave this enrollment with no way to sign in.
    const { pool, calls } = harness({ link: linkedTo("10117"), byId: [hrAccount({ client_id: "77" })] });

    await assert.rejects(
      () => accountFor(pool, enrollment(), CLIENT_ID),
      (error) => error.statusCode === 409 && /already enrolled/.test(error.message),
    );
    assert.equal(callTo(calls, CREATE_USER), undefined, "and no second account is made to get round it");
  });

  test("an account that comes back with no client record is refused too", async () => {
    const { pool } = harness({ link: linkedTo("10117"), byId: [hrAccount({ client_id: null })] });

    await assert.rejects(() => accountFor(pool, enrollment(), CLIENT_ID), (error) => error.statusCode === 409);
  });

  test("an account that cannot be read back is refused", async () => {
    const { pool } = harness({ link: linkedTo("10117"), byId: [] });

    await assert.rejects(() => accountFor(pool, enrollment(), CLIENT_ID), (error) => error.statusCode === 409);
  });
});
