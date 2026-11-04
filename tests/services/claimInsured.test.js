import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";
import { fakePool } from "../helpers/fakePool.js";
import { AppError } from "../../src/utils/AppError.js";

const { insuredFor } = await import("../../src/services/claimService.js");
const { default: employeeRoutes } = await import("../../src/routes/employeeRoutes.js");

const ENROLLMENT = "bes.usp_get_insurance_enrollment_by_id";
const BENEFITS = "bes.usp_get_enrollment_benefits_by_id";

const ROW = {
  client_id: "75",
  enrollment_id: "76",
  first_name: "Maria",
  middle_name: "Reyes",
  last_name: "Santos",
  suffix: "",
  birthdate: "1991-03-14",
  gender: "F",
  company_name: "Acme Holdings Inc.",
  policy_no: "G-TLI-26-177",
  classification_desc: "Rank and file",
  enrollment_date: new Date(2026, 0, 5, 9, 0),
};

// What the filing form shows before anything is sent: the snapshot a filed claim keeps.
describe("insuredFor", () => {
  test("is the insured and the coverage, as a filed claim would keep them", async () => {
    const { pool } = fakePool({
      [ENROLLMENT]: [ROW],
      [BENEFITS]: [{ benefit_name: "GTLIP", benefit_description: "Group Term Life Insurance Plan", coverage_amount: 500000, coverage_formula: null }],
    });

    assert.deepEqual(await insuredFor(pool, "75"), {
      insured: {
        client_id: "75",
        enrollment_id: "76",
        full_name: "Maria Reyes Santos",
        birthdate: "1991-03-14",
        gender: "F",
        company_code: null,
        company_name: "Acme Holdings Inc.",
        policy_no: "G-TLI-26-177",
        classification: "Rank and file",
        effective_date: "2026-01-05",
      },
      coverage: [{ code: "GTLIP", description: "Group Term Life Insurance Plan", amount: 500000, formula: null }],
    });
  });

  test("an employee with no enrollment is 404", async () => {
    const { pool } = fakePool({ [ENROLLMENT]: [], [BENEFITS]: [] });

    await assert.rejects(insuredFor(pool, "75"), (error) => error instanceof AppError && error.statusCode === 404);
  });
});

// "insured" is not a claim id: the route is declared before /claims/:claim_id, which would otherwise
// answer it with "Claim not found".
describe("the employee's route for it", () => {
  test("comes before the route of one claim", () => {
    const order = employeeRoutes.stack
      .filter((layer) => layer.route?.methods.get)
      .map((layer) => layer.route.path);

    assert.ok(order.includes("/claims/insured"));
    assert.ok(order.indexOf("/claims/insured") < order.indexOf("/claims/:claim_id"));
  });
});
