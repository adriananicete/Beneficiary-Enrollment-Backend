import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";
import { callTo, fakePool, inputsFor } from "../helpers/fakePool.js";

const { default: EnrollmentWipeService } = await import("../../src/services/enrollmentWipeService.js");

// The development wipe, DBA request 26, read back 2026-10-15. The procedure
// deletes; what is tested here is what this side decides before it is ever
// called: which company, whether the caller may, and whether the typed code
// matches. Every refusal below leaves the procedure uncalled.

const WIPE = "usp_del_company_enrollees";
const EMPLOYERS_BY_USER = "sec.us08_usp_sel_employers_by_user";
const COMPANY = "usp_sel_employer_admin_by_id";

const HR = { user_id: 3, role_name: "HR" };
const ADMIN = { user_id: 1, role_name: "Administrator" };

const TESTCO = { employer_id: "9", company_code: "TESTCO", company_name: "Test Company" };

const poolFor = ({ hrCompanies = [TESTCO], company = [TESTCO], wiped = { people_deleted: 4, enrollments_deleted: 3 } } = {}) =>
  fakePool({
    [EMPLOYERS_BY_USER]: hrCompanies,
    [COMPANY]: company,
    [WIPE]: [wiped],
  });

// `scripted` is what poolFor answers: the pool, and the calls it recorded.
const refused = async (scripted, user, body, statusCode, message) => {
  const { pool, calls } = scripted;
  await assert.rejects(
    () => EnrollmentWipeService.wipe(pool, user, body),
    (error) => error.statusCode === statusCode && error.message === message,
  );
  assert.equal(callTo(calls, WIPE), undefined, "the procedure was called after a refusal");
};

describe("enrollmentWipeService — HR, its own company", () => {
  test("wipes the company it is mapped to, sending the typed code", async () => {
    const { pool, calls } = poolFor();

    const result = await EnrollmentWipeService.wipe(pool, HR, { confirm: " testco " });

    assert.deepEqual(inputsFor(calls, WIPE), { us01_user_id: 3, employer_id: "9", confirm_code: "testco" });
    assert.deepEqual(result, { employer_id: "9", company_code: "TESTCO", people_deleted: 4, enrollments_deleted: 3 });
  });

  test("its own employer_id, sent anyway, is accepted", async () => {
    const { pool, calls } = poolFor();

    await EnrollmentWipeService.wipe(pool, HR, { employer_id: 9, confirm: "TESTCO" });

    assert.equal(inputsFor(calls, WIPE).employer_id, "9");
  });

  // Refused, not replaced: nobody should believe they wiped a company they
  // did not.
  test("another company's employer_id is 403", async () => {
    await refused(poolFor(), HR, { employer_id: "1", confirm: "Coforge" }, 403, "You can only wipe your own company's enrollments");
  });

  test("an account with no company is 403", async () => {
    await refused(poolFor({ hrCompanies: [] }), HR, { confirm: "TESTCO" }, 403, "No company is assigned to your account");
  });

  // Never the Administrator's company lookup, which refuses HR (50182).
  test("reads its company from its own mapping", async () => {
    const { pool, calls } = poolFor();

    await EnrollmentWipeService.wipe(pool, HR, { confirm: "TESTCO" });

    assert.equal(inputsFor(calls, EMPLOYERS_BY_USER).us01_user_id, 3);
    assert.equal(callTo(calls, COMPANY), undefined);
  });
});

describe("enrollmentWipeService — the Administrator, a named company", () => {
  test("wipes the company named, sending the typed code", async () => {
    const { pool, calls } = poolFor();

    const result = await EnrollmentWipeService.wipe(pool, ADMIN, { employer_id: "9", confirm: "TestCo" });

    assert.deepEqual(inputsFor(calls, COMPANY), { us01_user_id: 1, employer_id: "9" });
    assert.deepEqual(inputsFor(calls, WIPE), { us01_user_id: 1, employer_id: "9", confirm_code: "TestCo" });
    assert.equal(result.people_deleted, 4);
  });

  test("without employer_id is 400", async () => {
    for (const employer_id of [undefined, null, ""])
      await refused(poolFor(), ADMIN, { employer_id, confirm: "TESTCO" }, 400, "employer_id is required");
  });

  test("an employer_id that cannot be one is 400", async () => {
    for (const employer_id of ["abc", "9; DROP", -1, 1.5, {}, ["9"], true])
      await refused(poolFor(), ADMIN, { employer_id, confirm: "TESTCO" }, 400, "employer_id must be a company id");
  });

  test("a company that does not exist is 404", async () => {
    await refused(poolFor({ company: [] }), ADMIN, { employer_id: "99", confirm: "TESTCO" }, 404, "Company not found");
  });
});

describe("enrollmentWipeService — the confirmation", () => {
  test("no confirmation is 400", async () => {
    for (const confirm of [undefined, null, "", "   ", 9])
      await refused(poolFor(), HR, { confirm }, 400, "confirm is required: type the company's code");
  });

  // Checked here against the company as read, before the procedure checks it
  // again (50221).
  test("a code that is not the company's is 400", async () => {
    await refused(poolFor(), HR, { confirm: "TESTC0" }, 400, "The confirmation does not match the company code");
    await refused(poolFor(), ADMIN, { employer_id: "9", confirm: "Coforge" }, 400, "The confirmation does not match the company code");
  });

  test("no body at all is 400, not a crash", async () => {
    const { pool } = poolFor();

    await assert.rejects(
      () => EnrollmentWipeService.wipe(pool, HR, undefined),
      (error) => error.statusCode === 400,
    );
  });
});

describe("enrollmentWipeService — the procedure's answer", () => {
  // Zero people is not an error: a company with no enrollees yet.
  test("nothing to wipe answers zeros", async () => {
    const { pool } = poolFor({ wiped: { people_deleted: 0, enrollments_deleted: 0 } });

    const result = await EnrollmentWipeService.wipe(pool, HR, { confirm: "TESTCO" });

    assert.equal(result.people_deleted, 0);
    assert.equal(result.enrollments_deleted, 0);
  });

  // 50220 and 50221 are the procedure's own guards; they reach the error
  // handler as thrown.
  test("a refusal from the procedure reaches the caller as thrown", async () => {
    const refusal = Object.assign(new Error("You are not allowed"), { number: 50220 });
    const { pool } = fakePool({
      [EMPLOYERS_BY_USER]: [TESTCO],
      [WIPE]: () => {
        throw refusal;
      },
    });

    await assert.rejects(() => EnrollmentWipeService.wipe(pool, HR, { confirm: "TESTCO" }), (error) => error === refusal);
  });
});
