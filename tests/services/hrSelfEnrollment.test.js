import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";
import { callTo, fakePool, inputsFor } from "../helpers/fakePool.js";

const { accountFor, sendEnrollmentConfirmation, ALREADY_ENROLLED_AS_HR } = await import("../../src/services/enrollmentService.js");
const { refuseHrAccount, HR_ACCOUNT_NO_RESEND } = await import("../../src/controllers/adminController.js");
const { hrEnrollmentEmailTemplate } = await import("../../src/utils/hrEnrollmentEmailTemplate.js");
const { sqlErrorMap } = await import("../../src/utils/sqlErrorMap.js");
const { default: config } = await import("../../src/config/env.js");
const { EMPLOYEE_ROLE_ID } = await import("../../src/utils/constants.js");

// An HR person who enrolls themselves (DBA request 31): their HR account is
// linked to the new client record, no second account is made, and the
// confirmation carries their HR username and no password.

const LINK = "sec.us01_usp_link_hr_client";
const BY_ID = "sec.us01_usp_sel_user_by_id";
const CREATE = "sec.us01_usp_ins_users";
const ASSIGN = "sec.us04_usp_assign_role";

const ENROLLMENT = {
  email_address: "  maria@abcc.example  ",
  employer_id: "5",
  employee_id_number: "ABC-00123",
  first_name: "Maria",
  middle_name: null,
  last_name: "Reyes",
};

const hrRow = (overrides = {}) => ({
  us01_user_id: "3",
  us01_username: "hr.abcc",
  client_id: "90",
  us02_role_name: "HR",
  ...overrides,
});

const transactionFor = ({ linked = "3", byId = [hrRow()] } = {}) =>
  fakePool({
    [LINK]: typeof linked === "function" ? linked : [{ us01_user_id: linked }],
    [BY_ID]: byId,
    [CREATE]: () => ({ recordset: [], output: { us01_user_id: "41" } }),
    [ASSIGN]: [],
  });

describe("accountFor: the account an enrollment gives its person", () => {
  test("an HR person of the company: linked, by the invitation's email trimmed, with no second account", async () => {
    const { pool, calls } = transactionFor();

    const account = await accountFor(pool, { ...ENROLLMENT }, "90");

    assert.deepEqual(account, { hrUsername: "hr.abcc" });
    assert.deepEqual(inputsFor(calls, LINK), {
      client_id: "90",
      email_address: "maria@abcc.example",
      employer_id: "5",
      linked_by: "system",
    });
    assert.equal(callTo(calls, CREATE), undefined, "a second account was made");
    assert.equal(callTo(calls, ASSIGN), undefined);
  });

  test("anyone else: an Employee account under their Employee ID, with a temporary password", async () => {
    const { pool, calls } = transactionFor({ linked: null });

    const account = await accountFor(pool, { ...ENROLLMENT }, "90");

    assert.match(account.tempPassword, /^.{12}$/);
    assert.equal(account.hrUsername, undefined);
    assert.equal(inputsFor(calls, CREATE).us01_username, "ABC-00123");
    assert.equal(inputsFor(calls, CREATE).client_id, "90");
    assert.equal(inputsFor(calls, CREATE).us01_must_change_password, 1);
    assert.deepEqual(inputsFor(calls, ASSIGN), { us01_user_id: "41", us02_role_id: EMPLOYEE_ROLE_ID, us04_assigned_by: "system" });
    assert.equal(callTo(calls, BY_ID), undefined);
  });

  // Until request 31's fix is proven on UAT: a link that did not take refuses
  // the enrollment rather than leave it with no way to sign in.
  test("an HR account still linked to another enrollment is refused, 409, and no account is made", async () => {
    const { pool, calls } = transactionFor({ byId: [hrRow({ client_id: "77" })] });

    await assert.rejects(() => accountFor(pool, { ...ENROLLMENT }, "90"), { statusCode: 409, message: ALREADY_ENROLLED_AS_HR });
    assert.equal(callTo(calls, CREATE), undefined);
  });

  test("the procedure's own refusal, 50222, reaches the caller to roll back, and is a 409", async () => {
    const { pool } = transactionFor({
      linked: () => {
        throw Object.assign(new Error("This HR account is already enrolled as an employee."), { number: 50222 });
      },
    });

    await assert.rejects(() => accountFor(pool, { ...ENROLLMENT }, "90"), { number: 50222 });
    assert.equal(sqlErrorMap[50222].statusCode, 409);
  });
});

describe("sendEnrollmentConfirmation", () => {
  const capture = () => {
    const sent = { employee: [], hr: [] };
    return { sent, senders: { employee: async (mail) => sent.employee.push(mail), hr: async (mail) => sent.hr.push(mail) } };
  };

  const MAIL = { to: "maria@abcc.example", policyNo: "G-TLI-26-150-2600001", firstName: "Maria", employeeIdNumber: "ABC-00123", attachments: [] };

  test("an HR person gets the HR email: their HR username, the HR login, and no password", async () => {
    const { sent, senders } = capture();

    await sendEnrollmentConfirmation({ hrUsername: "hr.abcc" }, MAIL, senders);

    assert.equal(sent.employee.length, 0);
    assert.deepEqual(sent.hr, [
      { to: MAIL.to, policyNo: MAIL.policyNo, firstName: "Maria", username: "hr.abcc", loginUrl: config.appUrl, attachments: [] },
    ]);
  });

  test("anyone else gets the employee email, with their temporary password and the employee login", async () => {
    const { sent, senders } = capture();

    await sendEnrollmentConfirmation({ tempPassword: "Tmp-Pass-123" }, MAIL, senders);

    assert.equal(sent.hr.length, 0);
    assert.equal(sent.employee[0].username, "ABC-00123");
    assert.equal(sent.employee[0].password, "Tmp-Pass-123");
    assert.equal(sent.employee[0].loginUrl, `${config.appUrl}/employee-login`);
  });
});

describe("hrEnrollmentEmailTemplate", () => {
  // The Graph message body: { contentType: "HTML", content }.
  const text = (overrides) =>
    hrEnrollmentEmailTemplate({
      policyNo: "G-TLI-26-150-2600001",
      username: "hr.abcc",
      firstName: "Maria",
      loginUrl: "https://bes.example",
      ...overrides,
    }).content;

  test("names the policy and the HR username, and never a password", () => {
    const body = text();

    assert.match(body, /G-TLI-26-150-2600001/);
    assert.match(body, /hr\.abcc/);
    assert.doesNotMatch(body, /Password:|temporary password/i);
  });

  test("every value is escaped", () => {
    const body = text({ firstName: "<b>Maria</b>", username: "hr.<i>x</i>" });

    assert.doesNotMatch(body, /<b>Maria<\/b>/);
    assert.match(body, /&lt;b&gt;Maria&lt;\/b&gt;/);
    assert.doesNotMatch(body, /<i>x<\/i>/);
  });

  test("says the certificate is attached only when it is", () => {
    assert.match(text({ certificateAttached: true }), /Certificate of Coverage is attached/);
    assert.doesNotMatch(text({ certificateAttached: false }), /Certificate of Coverage is attached/);
  });
});

describe("refuseHrAccount: an employee resend never resets an HR login", () => {
  const check = (row) => {
    const { pool } = fakePool({ [BY_ID]: row ? [row] : [] });
    return refuseHrAccount(pool, { us01_user_id: "3" });
  };

  test("an HR or Administrator account is 409, with where to go instead", async () => {
    for (const role of ["HR", "Administrator"])
      await assert.rejects(() => check(hrRow({ us02_role_name: role })), { statusCode: 409, message: HR_ACCOUNT_NO_RESEND }, role);
  });

  test("an Employee account goes on, as does one whose role was withdrawn", async () => {
    await assert.doesNotReject(() => check(hrRow({ us02_role_name: "Employee" })));
    await assert.doesNotReject(() => check(null));
  });
});
