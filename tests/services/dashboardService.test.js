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

// Three enrolled, one client with no enrollment row — the LEFT JOIN miss that
// makes total_count the wrong number to count with.
const EMPLOYEES = [
  { client_id: 1, enrollment_id: 11, total_count: 4 },
  { client_id: 2, enrollment_id: 12, total_count: 4 },
  { client_id: 3, enrollment_id: 13, total_count: 4 },
  { client_id: 4, enrollment_id: null, total_count: 4 },
];

const invitationAnswer = (inputs) => {
  // total_count is what the procedure returns for the whole filtered set, and
  // it does not change with page_size.
  if (inputs.is_enrolled === 0) return { recordset: [{ total_count: 13 }], output: {} };
  if (inputs.send_status === "failed") return { recordset: [{ total_count: 2 }], output: {} };

  return { recordset: [], output: {} };
};

const HR_ANSWERS = {
  usp_sel_hr_employees: EMPLOYEES,
  usp_sel_client_change_request_pending_count: [{ pendingCount: 3 }],
  usp_sel_enrollment_invitations_by_user: invitationAnswer,
};

describe("DashboardService.getStats — HR", () => {
  test("returns the four counts", async () => {
    const { pool } = fakePool(HR_ANSWERS);

    const stats = await DashboardService.getStats(pool, HR);

    assert.deepEqual(stats, {
      enrolled: 3,
      awaitingEnrollment: 13,
      pendingChangeRequests: 3,
      failedInvitations: 2,
    });
  });

  test("counts enrollments, not employees", async () => {
    // The fixture has four employees and three enrollments, and total_count
    // says 4. Reading total_count would be cheaper and wrong: an employee
    // whose enrollment row is missing is a LEFT JOIN miss, not an enrollee.
    const { pool } = fakePool(HR_ANSWERS);

    const stats = await DashboardService.getStats(pool, HR);

    assert.equal(stats.enrolled, 3);
    assert.notEqual(stats.enrolled, EMPLOYEES[0].total_count);
  });

  test("asks the invitation procedure for one row, not the whole list", async () => {
    // COUNT(*) OVER() is computed before OFFSET/FETCH, so the count is right
    // whatever the page size. Pulling every invitation to count them would be
    // the thing this avoids.
    const { pool, calls } = fakePool(HR_ANSWERS);

    await DashboardService.getStats(pool, HR);

    const invitationCalls = calls.filter(
      (c) => c.procedure === "usp_sel_enrollment_invitations_by_user",
    );

    assert.equal(invitationCalls.length, 2);
    for (const call of invitationCalls) assert.equal(call.inputs.page_size, 1);
  });

  test("reads every count through a procedure that already carries the scoping", async () => {
    // The design constraint, asserted rather than left to a comment. Company
    // scoping is an access rule; a raw query reproducing it would be a second
    // implementation of it. If one ever appears here, this goes red.
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
});

describe("DashboardService.getStats — Administrator", () => {
  test("the two invitation counts are null, not zero", async () => {
    // usp_sel_enrollment_invitations_by_user throws 50073 for any caller who
    // is not HR — it checks r.us02_role_name = 'HR' with no Administrator
    // branch, unlike every other list procedure. PARK.md §3.
    //
    // Zero would say nobody is waiting to enrol. The truth is that we were not
    // allowed to look, and those are different answers.
    const { pool } = fakePool({
      usp_sel_hr_employees: EMPLOYEES,
      usp_sel_client_change_request_pending_count: [{ pendingCount: 3 }],
    });

    const stats = await DashboardService.getStats(pool, ADMINISTRATOR);

    assert.equal(stats.awaitingEnrollment, null);
    assert.equal(stats.failedInvitations, null);
  });

  test("still gets the two counts an Administrator is allowed", async () => {
    const { pool } = fakePool({
      usp_sel_hr_employees: EMPLOYEES,
      usp_sel_client_change_request_pending_count: [{ pendingCount: 3 }],
    });

    const stats = await DashboardService.getStats(pool, ADMINISTRATOR);

    assert.equal(stats.enrolled, 3);
    assert.equal(stats.pendingChangeRequests, 3);
  });

  test("does not call the invitation procedure at all", async () => {
    // Refused before it is asked rather than asked and caught. Catching a 403
    // would work and would also swallow a real failure.
    const { pool, calls } = fakePool({
      usp_sel_hr_employees: EMPLOYEES,
      usp_sel_client_change_request_pending_count: [{ pendingCount: 3 }],
    });

    await DashboardService.getStats(pool, ADMINISTRATOR);

    assert.ok(
      !calls.some(
        (c) => c.procedure === "usp_sel_enrollment_invitations_by_user",
      ),
    );
  });
});
