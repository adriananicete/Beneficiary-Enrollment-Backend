import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";
import { callTo, fakePool } from "../helpers/fakePool.js";
import { makeNext, makeReq, makeRes } from "../helpers/http.js";
import { CREDIT_PLAN, LIMITS, useDevStore } from "../helpers/gcliStore.js";

const { createCreditSubmission, creditProblem, invitationExtras } = await import("../../src/gcli/creditSubmission.js");
const { savePlan } = await import("../../src/gcli/companies.js");
const { readStore } = await import("../../src/gcli/devStore.js");
const { decideApplication } = await import("../../src/gcli/applications.js");

const TOKEN = "a".repeat(64);

const invitationRow = (overrides = {}) => ({
  invitation_id: "41",
  employer_id: "2",
  company_name: "Bluepoint Lending Corporation",
  email_address: "ana.reyes@bluepoint.example",
  is_valid: 1,
  is_enrolled: 0,
  ...overrides,
});

// What the form sends for a borrower: no classification, no beneficiaries, no employment.
const body = (overrides = {}) => ({
  token: TOKEN,
  employer_id: "2",
  employee_id_number: "EMP-2201",
  first_name: "Ana",
  middle_name: "Marie",
  last_name: "Reyes",
  suffix: "",
  birthdate: "1992-03-14",
  birthplace: "Quezon City",
  nationality: "Filipino",
  civil_status: "Single",
  gender: "F",
  height: 160,
  weight: 55,
  tin_id: "123-456-789",
  contact_no: "09171234567",
  office_no: null,
  email_address: "ana.reyes@bluepoint.example",
  barangay_id: "012801001",
  address_line: "27 Mabini St",
  zip_code: "1100",
  consent_privacy: true,
  consent_terms: true,
  coverage_amount: 850000,
  loan: { loan_reference: "BP-2026-004187", purpose: "Salary loan", loan_amount: 850000, term_months: 36, release_date: "2026-11-02" },
  ...overrides,
});

describe("creditProblem", () => {
  test("lets what a borrower sends through", () => {
    assert.equal(creditProblem(body()), null);
  });

  test("does not ask for a classification, beneficiaries, employment or income", () => {
    const sent = body();
    for (const field of ["classification_id", "beneficiaries", "sss_gsis_no", "position_title", "occupation", "source_of_income"])
      assert.equal(field in sent, false, `the fixture has no ${field}`);
    assert.equal(creditProblem(sent), null);
  });

  test("refuses each required field by name", () => {
    for (const field of ["employee_id_number", "first_name", "last_name", "address_line", "nationality", "tin_id", "barangay_id", "zip_code", "birthplace", "birthdate", "civil_status", "gender", "height", "weight", "contact_no", "consent_privacy", "consent_terms", "token"]) {
      const sent = body();
      delete sent[field];
      assert.equal(creditProblem(sent), `${field} is required`, field);
    }
  });

  test("runs the usual field rules", () => {
    assert.match(creditProblem(body({ height: 5 })), /height/i);
    assert.match(creditProblem(body({ birthdate: "1992-02-30" })), /birth/i);
    assert.ok(creditProblem(body({ contact_no: "123" })));
    assert.ok(creditProblem(body({ first_name: "x".repeat(101) })));
    assert.ok(creditProblem(body({ first_name: "Ana2" })));
  });

  test("the loan must have its five fields, in the shape the database holds", () => {
    const loan = body().loan;
    assert.equal(creditProblem(body({ loan: undefined })), "loan is required");
    assert.equal(creditProblem(body({ loan: [] })), "loan is required");
    assert.equal(creditProblem(body({ loan: { ...loan, loan_reference: "" } })), "loan.loan_reference is required");
    assert.equal(creditProblem(body({ loan: { ...loan, purpose: undefined } })), "loan.purpose is required");
    assert.match(creditProblem(body({ loan: { ...loan, loan_reference: "x".repeat(31) } })), /30 characters/);
    assert.match(creditProblem(body({ loan: { ...loan, loan_amount: "lots" } })), /loan.loan_amount must be a whole number/);
    assert.match(creditProblem(body({ loan: { ...loan, loan_amount: 85.5 } })), /loan.loan_amount/);
    assert.match(creditProblem(body({ loan: { ...loan, term_months: 0.5 } })), /loan.term_months/);
    assert.match(creditProblem(body({ loan: { ...loan, release_date: "2026-02-30" } })), /loan.release_date/);
  });

  test("trims what was typed, and a body that is not an object is refused", () => {
    const sent = body({ first_name: "  Ana  ", loan: { ...body().loan, loan_reference: "  BP-1 " } });
    assert.equal(creditProblem(sent), null);
    assert.equal(sent.first_name, "Ana");
    assert.equal(sent.loan.loan_reference, "BP-1");
    assert.match(creditProblem(null), /must be an object/);
  });

  test("the fields kept as sent must be text, so a number or a list is not stored", () => {
    for (const field of ["employee_id_number", "address_line", "birthplace", "barangay_id", "tin_id"]) {
      assert.equal(creditProblem(body({ [field]: 2201 })), `${field} must be text`, `${field} as a number`);
      assert.equal(creditProblem(body({ [field]: ["a"] })), `${field} must be text`, `${field} as a list`);
    }
  });

  test("an office number is optional, text, and at most 30 characters", () => {
    for (const office of [undefined, null, "", "02-8123-4567"]) assert.equal(creditProblem(body({ office_no: office })), null, String(office));
    for (const office of [123, ["x"], "x".repeat(31)]) assert.match(creditProblem(body({ office_no: office })), /office_no/, String(office));
  });
});

describe("what the invitation lookup adds", () => {
  useDevStore();

  test("nothing with the dev store off", () => {
    process.env.GCLI_DEV_STORE = "false";
    assert.deepEqual(invitationExtras(invitationRow(), TOKEN), {});
  });

  test("a standard company says so, with no limits", () => {
    assert.deepEqual(invitationExtras(invitationRow({ employer_id: "9" }), TOKEN), { plan_template: "G-TLI", loan_limits: null });
  });

  test("a credit company gives its limits and the creditor", () => {
    savePlan("2", { plan: CREDIT_PLAN, loan_limits: LIMITS });

    assert.deepEqual(invitationExtras(invitationRow(), TOKEN), {
      plan_template: "G-CLI",
      loan_limits: LIMITS,
      creditor_name: "Bluepoint Lending Corporation",
    });
  });

  test("a credit company with no limits yet gives null, and the form falls back", () => {
    savePlan("2", { plan: CREDIT_PLAN });
    assert.equal(invitationExtras(invitationRow(), TOKEN).loan_limits, null);
  });

  test("a link whose application was sent is 409, and a returned one opens again", async () => {
    savePlan("2", { plan: CREDIT_PLAN, loan_limits: LIMITS });
    const { pool } = fakePool({ usp_sel_enrollment_invitation_by_token: [invitationRow()], usp_sel_employers: [{ employer_id: "2" }] }, [[/dbo\.barangay/, [{ one: 1 }]]]);
    const next = makeNext();
    await createCreditSubmission({ getPool: async () => pool })(makeReq({ body: body() }), makeRes(), next);

    assert.throws(() => invitationExtras(invitationRow(), TOKEN), { statusCode: 409, message: "You have already submitted an enrollment" });

    decideApplication({ clientId: "900000000001", employerIds: ["2"], action: "return", note: "n", by: "hr" });
    assert.equal(invitationExtras(invitationRow(), TOKEN).plan_template, "G-CLI");
  });
});

describe("the submit of a credit company's borrower", () => {
  useDevStore();

  const run = async ({ sent = body(), invitation = invitationRow(), resubmit = false, existingUser = false, barangay = true, employerActive = true } = {}) => {
    const { pool, calls } = fakePool(
      {
        usp_sel_enrollment_invitation_by_token: invitation === null ? [] : [invitation],
        usp_sel_employers: employerActive ? [{ employer_id: "2" }, { employer_id: "9" }] : [{ employer_id: "9" }],
      },
      [
        [/dbo\.barangay/, barangay ? [{ one: 1 }] : []],
        [/sec\.us01_users/, existingUser ? [{ one: 1 }] : []],
      ],
    );
    const req = makeReq({ body: sent });
    const res = makeRes();
    const next = makeNext();

    await createCreditSubmission({ getPool: async () => pool, resubmit })(req, res, next);

    return { res, next, calls };
  };

  test("stores an application and answers 201, with no login made and nothing written to the database", async () => {
    savePlan("2", { plan: CREDIT_PLAN, loan_limits: LIMITS });
    const { res, next, calls } = await run();

    assert.equal(next.calls.length, 0, "the usual submit never runs");
    assert.equal(res.statusCode, 201);
    assert.deepEqual(res.body.data, { application_no: "GCLI-" + new Date().getFullYear() + "-0001", status: "pending" });
    assert.equal(readStore().applications.length, 1);

    const written = calls.filter((call) => call.procedure && /^(usp_ins|usp_upd|usp_del|sec\.us01_usp_ins)/.test(call.procedure));
    assert.deepEqual(written, [], "no insert or update was sent");
    for (const call of calls) assert.ok(/^usp_sel_/.test(call.procedure ?? "") || /^SELECT/.test(call.query ?? ""), `only reads: ${JSON.stringify(call)}`);
  });

  test("passes a standard company's submit on to the usual enrollment", async () => {
    const { res, next } = await run({ invitation: invitationRow({ employer_id: "9" }) });

    assert.ok(next.passed());
    assert.equal(res.statusCode, null);
    assert.deepEqual(readStore().applications, []);
  });

  test("passes on a token that is no invitation's, and a request that is not one", async () => {
    savePlan("2", { plan: CREDIT_PLAN, loan_limits: LIMITS });

    assert.ok((await run({ invitation: null })).next.passed());
    assert.ok((await run({ sent: { ...body(), token: "short" } })).next.passed());
    assert.ok((await run({ sent: {} })).next.passed());
  });

  test("passes everything on with the dev store off", async () => {
    savePlan("2", { plan: CREDIT_PLAN, loan_limits: LIMITS });
    process.env.GCLI_DEV_STORE = "false";
    const { next, calls } = await run();

    assert.ok(next.passed());
    assert.deepEqual(calls, [], "not even the invitation is read");
  });

  test("an expired link is 410 and an used one is 409", async () => {
    savePlan("2", { plan: CREDIT_PLAN, loan_limits: LIMITS });

    assert.deepEqual((await run({ invitation: invitationRow({ is_valid: 0 }) })).next.refusal(), {
      statusCode: 410,
      message: "This invitation has expired. Please ask your HR to resend it.",
    });
    assert.equal((await run({ invitation: invitationRow({ is_enrolled: 1 }) })).next.refusal().statusCode, 409);
  });

  test("a form that breaks a rule is 400 with the reason, and stores nothing", async () => {
    savePlan("2", { plan: CREDIT_PLAN, loan_limits: LIMITS });
    const sent = body();
    delete sent.first_name;

    assert.deepEqual((await run({ sent })).next.refusal(), { statusCode: 400, message: "first_name is required" });
    assert.deepEqual(readStore().applications, []);
  });

  test("a barangay that does not exist is 400, and an employee ID that is a login already is 409", async () => {
    savePlan("2", { plan: CREDIT_PLAN, loan_limits: LIMITS });

    assert.deepEqual((await run({ barangay: false })).next.refusal(), { statusCode: 400, message: "Invalid barangay" });
    assert.deepEqual((await run({ existingUser: true })).next.refusal(), { statusCode: 409, message: "Employee ID number already exists" });
  });

  test("a loan outside the company's limits is 422 with the reasons", async () => {
    savePlan("2", { plan: CREDIT_PLAN, loan_limits: LIMITS });
    const sent = body({ loan: { ...body().loan, loan_amount: 6200000 } });

    assert.deepEqual((await run({ sent })).next.refusal(), {
      statusCode: 422,
      message: "Bluepoint Lending Corporation covers loans up to PHP 5,000,000.",
    });
  });

  test("an invitation of a company that is no longer active is 400, as in the usual enrollment", async () => {
    savePlan("2", { plan: CREDIT_PLAN, loan_limits: LIMITS });

    assert.deepEqual((await run({ employerActive: false })).next.refusal(), { statusCode: 400, message: "Invalid or inactive employer" });
    assert.deepEqual(readStore().applications, []);
  });

  test("the same link in another case is the same link, not a second application", async () => {
    savePlan("2", { plan: CREDIT_PLAN, loan_limits: LIMITS });
    await run({ sent: body({ token: "ab".repeat(32) }) });

    const second = await run({ sent: body({ token: "AB".repeat(32), employee_id_number: "EMP-9999" }) });

    assert.deepEqual(second.next.refusal(), { statusCode: 409, message: "You have already submitted an enrollment" });
    assert.equal(readStore().applications.length, 1);
    assert.equal(readStore().applications[0].token, "ab".repeat(32), "kept under one spelling");
    assert.throws(() => invitationExtras(invitationRow(), "AB".repeat(32)), { statusCode: 409 }, "and the lookup knows it too");
  });

  test("the PUT needs a returned application, and is 404 for a company that is not a credit company's", async () => {
    savePlan("2", { plan: CREDIT_PLAN, loan_limits: LIMITS });

    assert.equal((await run({ resubmit: true })).next.refusal().statusCode, 409, "nothing to correct");
    assert.equal((await run({ resubmit: true, invitation: invitationRow({ employer_id: "9" }) })).next.refusal().statusCode, 404);
    assert.equal((await run({ resubmit: true, invitation: null })).next.refusal().statusCode, 404);
    assert.equal((await run({ resubmit: true, sent: {} })).next.refusal().statusCode, 404);
  });

  test("reads the invitation by its token, and nothing else of the form chooses the company", async () => {
    savePlan("2", { plan: CREDIT_PLAN, loan_limits: LIMITS });
    const { calls } = await run({ sent: body({ employer_id: "9" }) });

    assert.equal(callTo(calls, "usp_sel_enrollment_invitation_by_token").inputs.token, TOKEN);
    assert.equal(readStore().applications[0].employer_id, "2");
  });
});
