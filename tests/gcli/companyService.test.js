import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";
import { callTo, fakePool } from "../helpers/fakePool.js";
import { CREDIT_PLAN, LIMITS, useDevStore } from "../helpers/gcliStore.js";

const { default: CompanyService, companyOf } = await import("../../src/services/companyService.js");
const { savePlan } = await import("../../src/gcli/companies.js");
const { readStore } = await import("../../src/gcli/devStore.js");

// The company service with the dev store on: the plan and loan limits ride on the company the
// Administrator reads and writes, and the procedures are called exactly as they were.

const row = (overrides = {}) => ({
  employer_id: "5",
  company_code: "Bluepoint",
  company_name: "Bluepoint Lending Corporation",
  work_address: "Makati City",
  office_no: null,
  policy_no: "G-CLI-26-044",
  status: "A",
  send_coc_email: true,
  online_enrollment_max_age: null,
  hr_user_id: null,
  active_classifications: 0,
  active_enrollments: 0,
  policy_no_locked: false,
  ...overrides,
});

// The single-company procedure returns no messages_enabled, and the list does, so
// reading one company asks the list as well (companyService.js).
const pool = (stored = row()) =>
  fakePool({
    usp_sel_employer_admin_by_id: [stored],
    usp_sel_employers_admin: [{ ...stored, messages_enabled: false }],
    usp_ins_employer: [{ employer_id: "5" }],
    usp_upd_employer: [{ employer_id: "5" }],
  });

describe("a company with the dev store on", () => {
  useDevStore();

  test("gains its plan and loan limits", () => {
    savePlan("5", { plan: CREDIT_PLAN, loan_limits: LIMITS });
    const company = companyOf(row());

    assert.equal(company.plan_code, "GCLIP");
    assert.equal(company.plan_template, "G-CLI");
    assert.equal(company.plan_locked, false);
    assert.deepEqual(company.loan_limits, LIMITS);
  });

  test("a company with an enrollment already has its plan locked", () => {
    assert.equal(companyOf(row({ policy_no_locked: true })).plan_locked, true);
  });

  test("with the dev store off it is the company it always was", () => {
    process.env.GCLI_DEV_STORE = "false";
    savePlan("5", { plan: CREDIT_PLAN });
    const company = companyOf(row());

    for (const field of ["plan_code", "plan_desc", "plan_template", "plan_locked", "loan_limits"])
      assert.equal(field in company, false, field);
  });

  test("a new company is written as usual, then given its plan and limits", async () => {
    const { pool: fake, calls } = pool();

    const company = await CompanyService.createCompany(fake, 1, { company_code: "Bluepoint" }, { plan: CREDIT_PLAN, loan_limits: LIMITS });

    assert.ok(callTo(calls, "bes.usp_ins_employer"));
    assert.equal(company.plan_code, "GCLIP");
    assert.deepEqual(company.loan_limits, LIMITS);
    assert.deepEqual(readStore().companies["5"].loan_limits, LIMITS);
  });

  test("a new company without a plan is on the standard plan and stores nothing", async () => {
    const { pool: fake } = pool();
    const company = await CompanyService.createCompany(fake, 1, { company_code: "Bluepoint" });

    assert.equal(company.plan_code, "GTLIP");
    assert.deepEqual(readStore().companies, {});
  });

  test("limits sent for a company that is not on the credit plan are refused before anything is written", async () => {
    const { pool: fake, calls } = pool();

    await assert.rejects(CompanyService.createCompany(fake, 1, {}, { loan_limits: LIMITS }), { statusCode: 400 });
    assert.equal(callTo(calls, "bes.usp_ins_employer"), undefined);
  });

  test("a change of limits alone leaves the company row alone", async () => {
    savePlan("5", { plan: CREDIT_PLAN, loan_limits: LIMITS });
    const { pool: fake, calls } = pool();

    const company = await CompanyService.updateCompany(fake, 1, "5", {}, { loan_limits: { ...LIMITS, max_loan: 4000000 } });

    assert.equal(callTo(calls, "bes.usp_upd_employer"), undefined, "no write to the database");
    assert.equal(company.loan_limits.max_loan, 4000000);
  });

  test("a change of the company's fields and its limits together does both", async () => {
    savePlan("5", { plan: CREDIT_PLAN, loan_limits: LIMITS });
    const { pool: fake, calls } = pool();

    await CompanyService.updateCompany(fake, 1, "5", { work_address: "Ortigas" }, { loan_limits: { ...LIMITS, max_term_months: 48 } });

    assert.equal(callTo(calls, "bes.usp_upd_employer").inputs.work_address, "Ortigas");
    assert.equal(readStore().companies["5"].loan_limits.max_term_months, 48);
  });

  test("the plan cannot change once the company has an enrollment, and nothing is written", async () => {
    const { pool: fake, calls } = pool(row({ policy_no_locked: true }));

    await assert.rejects(
      CompanyService.updateCompany(fake, 1, "5", { work_address: "Ortigas" }, { plan: CREDIT_PLAN }),
      { statusCode: 409 },
    );
    assert.equal(callTo(calls, "bes.usp_upd_employer"), undefined);
    assert.deepEqual(readStore().companies, {});
  });

  test("a company that does not exist is still 404", async () => {
    const { pool: fake } = fakePool({ usp_sel_employer_admin_by_id: [] });
    await assert.rejects(CompanyService.updateCompany(fake, 1, "5", {}, { loan_limits: LIMITS }), { statusCode: 404 });
  });
});
