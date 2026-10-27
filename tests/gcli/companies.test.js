import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  assertPlanChange,
  creditCompanyOf,
  getPlans,
  planFieldsOf,
  savePlan,
  takePlanFields,
  withPlans,
} from "../../src/gcli/companies.js";
import { readStore, update } from "../../src/gcli/devStore.js";
import { fakePool } from "../helpers/fakePool.js";
import { makeNext, makeReq, makeRes } from "../helpers/http.js";
import { CREDIT_PLAN, LIMITS, useDevStore } from "../helpers/gcliStore.js";

// ref_plans as read on 2026-10-27: only the standard plan is switched on.
const PLAN_ROWS = [
  { plan_id: "2", plan_code: "GCLIP", plan_desc: "Group Credit Life Insurance Plan", template: "G-CLI", is_active: false },
  { plan_id: "3", plan_code: "GTLIP", plan_desc: "Group Term Life Insurance Plan", template: "G-TLI", is_active: true },
  { plan_id: "5", plan_code: "GADDP", plan_desc: "Group Accidental Death and Disability Plan", template: "G-ADD", is_active: false },
];

const plansPool = () => fakePool({}, [[/ref_plans/, PLAN_ROWS]]);

const runTake = async (body) => {
  const { pool } = plansPool();
  const req = makeReq({ body });
  const next = makeNext();
  await takePlanFields(async () => pool)(req, makeRes(), next);
  return { req, next };
};

describe("getPlans", () => {
  useDevStore();

  test("lists every plan, with the credit plan switched on while the dev store is", async () => {
    const { pool } = plansPool();
    const plans = await getPlans(pool);

    assert.deepEqual(
      plans.map((plan) => [plan.plan_code, plan.is_active]),
      [["GCLIP", true], ["GTLIP", true], ["GADDP", false]],
    );
    assert.deepEqual(Object.keys(plans[0]).sort(), ["is_active", "plan_code", "plan_desc", "plan_id", "template"]);
  });

  test("only reads: one SELECT of ref_plans and nothing else", async () => {
    const { pool, calls } = plansPool();
    await getPlans(pool);

    assert.equal(calls.length, 1);
    assert.match(calls[0].query, /^SELECT .* FROM dbo\.ref_plans/);
  });
});

describe("a company's plan", () => {
  useDevStore();

  test("a company with nothing stored is on the standard plan, with no limits", () => {
    assert.deepEqual(planFieldsOf("9"), {
      plan_code: "GTLIP",
      plan_desc: "Group Term Life Insurance Plan",
      plan_template: "G-TLI",
      plan_locked: false,
      loan_limits: null,
    });
    assert.equal(creditCompanyOf("9"), null);
  });

  test("a credit company has its plan and its limits", () => {
    savePlan("2", { plan: CREDIT_PLAN, loan_limits: LIMITS });

    assert.deepEqual(planFieldsOf("2"), { ...CREDIT_PLAN, plan_locked: false, loan_limits: LIMITS });
    assert.equal(creditCompanyOf(2).plan_code, "GCLIP", "a number finds the same company");
  });

  test("a credit company with no limits yet says null, and the standard plan never shows limits", () => {
    savePlan("2", { plan: CREDIT_PLAN });
    assert.equal(planFieldsOf("2").loan_limits, null);

    savePlan("2", { loan_limits: LIMITS });
    savePlan("2", { plan: { plan_code: "GTLIP", plan_desc: "Group Term Life Insurance Plan", plan_template: "G-TLI" } });
    assert.equal(planFieldsOf("2").loan_limits, null, "kept in the store, not shown for another plan");
    assert.equal(readStore().companies["2"].loan_limits.max_loan, 5000000);
  });

  test("the plan is locked once the company has an enrollment, or an application", () => {
    assert.equal(planFieldsOf("2", true).plan_locked, true);
    assert.equal(planFieldsOf("2", false).plan_locked, false);

    update((store) => store.applications.push({ employer_id: "2" }));
    assert.equal(planFieldsOf("2").plan_locked, true);
    assert.equal(planFieldsOf("3").plan_locked, false);
  });

  test("the credit company is nobody's with the dev store off", () => {
    savePlan("2", { plan: CREDIT_PLAN, loan_limits: LIMITS });
    process.env.GCLI_DEV_STORE = "false";
    assert.equal(creditCompanyOf("2"), null);
  });
});

describe("takePlanFields", () => {
  useDevStore();

  test("takes the plan and the limits off the body, so the company rules never see them", async () => {
    const { req, next } = await runTake({ company_name: "Bluepoint", plan_code: "GCLIP", loan_limits: { ...LIMITS, max_loan: "5000000" } });

    assert.ok(next.passed());
    assert.deepEqual(req.body, { company_name: "Bluepoint" });
    assert.deepEqual(req.plan, { plan: CREDIT_PLAN, loan_limits: LIMITS });
  });

  test("a body with neither is left alone, with no plan on the request", async () => {
    const { req, next } = await runTake({ company_name: "Bluepoint" });

    assert.ok(next.passed());
    assert.deepEqual(req.body, { company_name: "Bluepoint" });
    assert.equal(req.plan, undefined);
  });

  test("limits alone, and null limits to clear them", async () => {
    assert.deepEqual((await runTake({ loan_limits: LIMITS })).req.plan, { loan_limits: LIMITS });
    assert.deepEqual((await runTake({ loan_limits: null })).req.plan, { loan_limits: null });
  });

  test("a plan that does not exist is 400, and one that is switched off is 409", async () => {
    assert.deepEqual((await runTake({ plan_code: "NOPE" })).next.refusal(), { statusCode: 400, message: "That plan does not exist" });
    assert.deepEqual((await runTake({ plan_code: "GADDP" })).next.refusal(), { statusCode: 409, message: "That plan is not switched on" });
  });

  test("a plan code that is not text, or limits that do not fit, are 400 with the reason", async () => {
    assert.equal((await runTake({ plan_code: 3 })).next.refusal().statusCode, 400);
    assert.equal((await runTake({ plan_code: " " })).next.refusal().statusCode, 400);
    assert.deepEqual((await runTake({ loan_limits: { ...LIMITS, max_term_months: 700 } })).next.refusal(), {
      statusCode: 400,
      message: "max_term_months must be at most 600",
    });
  });

  test("does nothing with the dev store off, and then the company rules refuse the fields as before", async () => {
    process.env.GCLI_DEV_STORE = "false";
    const { req, next } = await runTake({ plan_code: "GCLIP" });

    assert.ok(next.passed());
    assert.deepEqual(req.body, { plan_code: "GCLIP" });
    assert.equal(req.plan, undefined);
  });
});

describe("assertPlanChange and savePlan", () => {
  useDevStore();

  test("the plan cannot change once the company has an enrollment", () => {
    savePlan("2", { plan: CREDIT_PLAN });
    const toStandard = { plan: { plan_code: "GTLIP", plan_desc: "x", plan_template: "G-TLI" } };

    assert.throws(() => assertPlanChange("2", toStandard, true), { statusCode: 409 });
    assert.doesNotThrow(() => assertPlanChange("2", toStandard, false));
  });

  test("the plan cannot change once the company has an application either", () => {
    savePlan("2", { plan: CREDIT_PLAN });
    update((store) => store.applications.push({ employer_id: "2" }));

    assert.throws(() => assertPlanChange("2", { plan: { plan_code: "GTLIP", plan_template: "G-TLI" } }), { statusCode: 409 });
  });

  test("sending the plan it is already on is not a change", () => {
    savePlan("2", { plan: CREDIT_PLAN });
    assert.doesNotThrow(() => assertPlanChange("2", { plan: CREDIT_PLAN }, true));
  });

  test("loan limits belong to the credit plan only", () => {
    assert.throws(() => assertPlanChange("9", { loan_limits: LIMITS }), { statusCode: 400 }, "a company on the standard plan");
    assert.throws(() => assertPlanChange(null, { loan_limits: LIMITS }), { statusCode: 400 }, "a new company defaults to it");
    assert.doesNotThrow(() => assertPlanChange(null, { plan: CREDIT_PLAN, loan_limits: LIMITS }), "unless it is made a credit company");
    assert.doesNotThrow(() => assertPlanChange("9", { plan: CREDIT_PLAN, loan_limits: LIMITS }));
    assert.doesNotThrow(() => assertPlanChange("9", { loan_limits: null }), "clearing is always fine");
  });

  test("a refused change writes nothing", () => {
    assert.throws(() => assertPlanChange("9", { loan_limits: LIMITS }));
    assert.deepEqual(readStore().companies, {});
  });
});

describe("withPlans", () => {
  useDevStore();

  test("each of HR's companies says its plan, for the menu", () => {
    savePlan("2", { plan: CREDIT_PLAN, loan_limits: LIMITS });
    const user = { user_id: "5", role_name: "HR", employers: [{ employer_id: "2", company_code: "Bluepoint" }, { employer_id: "9", company_code: "Abacus" }] };

    assert.deepEqual(withPlans(user).employers, [
      { employer_id: "2", company_code: "Bluepoint", plan_code: "GCLIP", plan_template: "G-CLI" },
      { employer_id: "9", company_code: "Abacus", plan_code: "GTLIP", plan_template: "G-TLI" },
    ]);
  });

  test("leaves the user as it was with the dev store off, or with no companies", () => {
    const user = { user_id: "5", employers: [{ employer_id: "2" }] };
    assert.deepEqual(withPlans({ user_id: "1", employers: [] }), { user_id: "1", employers: [] });
    assert.deepEqual(withPlans({ user_id: "1" }), { user_id: "1" });

    process.env.GCLI_DEV_STORE = "false";
    assert.equal(withPlans(user), user);
  });
});
