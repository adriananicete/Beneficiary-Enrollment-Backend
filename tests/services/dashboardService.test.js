import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";

const { default: DashboardService } = await import(
  "../../src/services/dashboardService.js"
);

// The second service reachable from a test, after invitationJobStore, and the
// first that talks to the database. Possible because src/config/db.js stopped
// connecting at import in PR #87.
//
// The fake records which procedure was asked for and with what, and answers
// from a script keyed by procedure name. No mocking library and no
// experimental flag — the models take their pool as the first argument, so a
// pool that remembers what it was asked is enough.
const fakePool = (answers) => {
  const calls = [];

  const request = () => {
    const inputs = {};

    const chain = {
      input(name, type, value) {
        inputs[name] = value;
        return chain;
      },
      output() {
        return chain;
      },
      async execute(procedure) {
        calls.push({ procedure, inputs });

        const answer = answers[procedure];
        if (answer === undefined)
          throw new Error(`fake pool has no answer for ${procedure}`);

        return typeof answer === "function"
          ? answer(inputs)
          : { recordset: answer, output: {} };
      },
    };

    return chain;
  };

  return { pool: { request }, calls };
};

const HR = { user_id: 7, role_name: "HR" };
const ADMINISTRATOR = { user_id: 1, role_name: "Administrator" };

// One company. Three enrolled, one client with no enrollment row — the LEFT
// JOIN miss that makes total_count the wrong number to count with.
const HR_EMPLOYEES = [
  { client_id: 1, enrollment_id: 11, company_code: "CFG", company_name: "Coforge", total_count: 4 },
  { client_id: 2, enrollment_id: 12, company_code: "CFG", company_name: "Coforge", total_count: 4 },
  { client_id: 3, enrollment_id: 13, company_code: "CFG", company_name: "Coforge", total_count: 4 },
  { client_id: 4, enrollment_id: null, company_code: "CFG", company_name: "Coforge", total_count: 4 },
];

// What an Administrator sees: usp_sel_hr_employees skips the employer filter
// for them, so every company comes back in one result set. HCL has an employee
// with no enrollment, which is how a company reaches zero rather than absent.
const ALL_EMPLOYEES = [
  { client_id: 1, enrollment_id: 11, company_code: "CFG", company_name: "Coforge", total_count: 5 },
  { client_id: 2, enrollment_id: 12, company_code: "CFG", company_name: "Coforge", total_count: 5 },
  { client_id: 3, enrollment_id: 13, company_code: "HCL", company_name: "HCL", total_count: 5 },
  { client_id: 4, enrollment_id: null, company_code: "HCL", company_name: "HCL", total_count: 5 },
  { client_id: 5, enrollment_id: null, company_code: "ZZZ", company_name: "Zenith", total_count: 5 },
];

const invitationAnswer = (inputs) => {
  // total_count is the count of the whole filtered set and does not change
  // with page_size.
  if (inputs.is_enrolled === 0) return { recordset: [{ total_count: 13 }], output: {} };
  if (inputs.send_status === "failed") return { recordset: [{ total_count: 2 }], output: {} };

  return { recordset: [], output: {} };
};

const HR_ANSWERS = {
  usp_sel_hr_employees: HR_EMPLOYEES,
  usp_sel_client_change_request_pending_count: [{ pendingCount: 3 }],
  usp_sel_enrollment_invitations_by_user: invitationAnswer,
};

// usp_sel_employers with its default @include_inactive = 0 returns every
// ACTIVE employer, ordered by company_name. Nova has no employees at all —
// a company onboarded but not yet invited.
const EMPLOYERS = [
  { employer_id: 1, company_code: "CFG", company_name: "Coforge", status: "A" },
  { employer_id: 2, company_code: "HCL", company_name: "HCL", status: "A" },
  { employer_id: 4, company_code: "NVA", company_name: "Nova", status: "A" },
  { employer_id: 3, company_code: "ZZZ", company_name: "Zenith", status: "A" },
];

const ADMIN_ANSWERS = {
  usp_sel_hr_employees: ALL_EMPLOYEES,
  usp_sel_employers: EMPLOYERS,
};

describe("DashboardService.getStats — HR", () => {
  test("returns the four counts HR works from", async () => {
    const { pool } = fakePool(HR_ANSWERS);

    assert.deepEqual(await DashboardService.getStats(pool, HR), {
      scope: "company",
      enrolled: 3,
      awaitingEnrollment: 13,
      pendingChangeRequests: 3,
      failedInvitations: 2,
    });
  });

  test("counts enrollments, not employees", async () => {
    // Four employees, three enrollments, and total_count says 4. Reading
    // total_count would be cheaper and wrong.
    const { pool } = fakePool(HR_ANSWERS);

    const stats = await DashboardService.getStats(pool, HR);

    assert.equal(stats.enrolled, 3);
    assert.notEqual(stats.enrolled, HR_EMPLOYEES[0].total_count);
  });

  test("asks the invitation procedure for one row, not the whole list", async () => {
    const { pool, calls } = fakePool(HR_ANSWERS);

    await DashboardService.getStats(pool, HR);

    const invitationCalls = calls.filter(
      (c) => c.procedure === "usp_sel_enrollment_invitations_by_user",
    );

    assert.equal(invitationCalls.length, 2);
    for (const call of invitationCalls) assert.equal(call.inputs.page_size, 1);
  });

  test("reads every count through a procedure that already carries the scoping", async () => {
    // The design constraint, asserted rather than left to a comment. If a raw
    // query ever appears in this service, this goes red.
    const { pool, calls } = fakePool(HR_ANSWERS);

    await DashboardService.getStats(pool, HR);

    assert.deepEqual(
      [...new Set(calls.map((c) => c.procedure))].sort(),
      [
        "usp_sel_client_change_request_pending_count",
        "usp_sel_enrollment_invitations_by_user",
        "usp_sel_hr_employees",
      ],
    );

    for (const call of calls)
      assert.equal(call.inputs.us01_user_id, HR.user_id, call.procedure);
  });

  test("an empty invitation result is zero, not undefined", async () => {
    const { pool } = fakePool({
      ...HR_ANSWERS,
      usp_sel_enrollment_invitations_by_user: [],
    });

    const stats = await DashboardService.getStats(pool, HR);

    assert.equal(stats.awaitingEnrollment, 0);
    assert.equal(stats.failedInvitations, 0);
  });

  test("HR gets no per-company breakdown — they have one company", async () => {
    const { pool } = fakePool(HR_ANSWERS);

    const stats = await DashboardService.getStats(pool, HR);

    assert.equal(stats.byCompany, undefined);
  });
});

describe("DashboardService.getStats — Administrator", () => {
  test("returns the total across every company, and the split", async () => {
    const { pool } = fakePool(ADMIN_ANSWERS);

    assert.deepEqual(await DashboardService.getStats(pool, ADMINISTRATOR), {
      scope: "all-companies",
      enrolled: 3,
      byCompany: [
        { employer_id: 1, company_code: "CFG", company_name: "Coforge", enrolled: 2 },
        { employer_id: 2, company_code: "HCL", company_name: "HCL", enrolled: 1 },
        { employer_id: 4, company_code: "NVA", company_name: "Nova", enrolled: 0 },
        { employer_id: 3, company_code: "ZZZ", company_name: "Zenith", enrolled: 0 },
      ],
    });
  });

  test("a company with no employees at all still appears, at zero", async () => {
    // Nova is onboarded and has never been invited. Before the employer list
    // was seeded in, it was absent from the split — which is the one moment
    // somebody most wants to see a zero.
    const { pool } = fakePool(ADMIN_ANSWERS);

    const stats = await DashboardService.getStats(pool, ADMINISTRATOR);
    const nova = stats.byCompany.find((c) => c.company_code === "NVA");

    assert.equal(nova.enrolled, 0);
    assert.equal(nova.employer_id, 4);
  });

  test("a company in the employee rows but not the employer list is not dropped", async () => {
    // Cannot happen by construction — usp_sel_hr_employees joins employers on
    // status = 'A' and usp_sel_employers returns exactly that set. Covered
    // anyway, because "by construction" is a claim about two procedures that
    // could drift apart, and silently dropping a company is worse than showing
    // one that surprises us. employer_id is null because the employee
    // projection does not carry it.
    const { pool } = fakePool({
      ...ADMIN_ANSWERS,
      usp_sel_employers: [EMPLOYERS[0]],
    });

    const stats = await DashboardService.getStats(pool, ADMINISTRATOR);
    const hcl = stats.byCompany.find((c) => c.company_code === "HCL");

    assert.equal(hcl.enrolled, 1);
    assert.equal(hcl.employer_id, null);
  });

  test("the per-company numbers add up to the total", async () => {
    // Cheap, and it is the assertion somebody would actually notice on screen.
    const { pool } = fakePool(ADMIN_ANSWERS);

    const stats = await DashboardService.getStats(pool, ADMINISTRATOR);
    const summed = stats.byCompany.reduce((total, c) => total + c.enrolled, 0);

    assert.equal(summed, stats.enrolled);
  });

  test("a company with employees but no enrollments shows zero, not absent", async () => {
    // Zenith has one employee and no enrollment. Those rows are a LEFT JOIN
    // miss rather than missing rows, so the company is visible with 0.
    const { pool } = fakePool(ADMIN_ANSWERS);

    const stats = await DashboardService.getStats(pool, ADMINISTRATOR);
    const zenith = stats.byCompany.find((c) => c.company_code === "ZZZ");

    assert.equal(zenith.enrolled, 0);
  });

  test("sorted by company name, so the list does not reorder between loads", async () => {
    const { pool } = fakePool(ADMIN_ANSWERS);

    const stats = await DashboardService.getStats(pool, ADMINISTRATOR);

    assert.deepEqual(
      stats.byCompany.map((c) => c.company_name),
      ["Coforge", "HCL", "Nova", "Zenith"],
    );
  });

  test("none of the three HR queues appear", async () => {
    // Deliberate, settled 2026-09-07. Chasing the unenrolled, deciding change
    // requests and resending failed invitations are HR's work, not oversight.
    const { pool } = fakePool(ADMIN_ANSWERS);

    const stats = await DashboardService.getStats(pool, ADMINISTRATOR);

    assert.equal(stats.awaitingEnrollment, undefined);
    assert.equal(stats.pendingChangeRequests, undefined);
    assert.equal(stats.failedInvitations, undefined);
  });

  test("only one procedure is called at all", async () => {
    // The fake throws for any procedure it has no answer for, so calling the
    // invitation or pending-count procedures here would fail rather than pass
    // quietly. usp_sel_enrollment_invitations_by_user would have thrown 50073
    // for an Administrator anyway — this is the reason that no longer matters.
    const { pool, calls } = fakePool(ADMIN_ANSWERS);

    await DashboardService.getStats(pool, ADMINISTRATOR);

    assert.deepEqual(
      [...new Set(calls.map((c) => c.procedure))].sort(),
      ["usp_sel_employers", "usp_sel_hr_employees"],
    );
  });
});
