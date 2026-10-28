import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import "../helpers/env.js";
import { fakePool } from "../helpers/fakePool.js";
import { makeNext, makeReq, makeRes } from "../helpers/http.js";
import { CREDIT_PLAN, LIMITS, useDevStore } from "../helpers/gcliStore.js";

const {
  applyInvitedEmployeeId,
  clearInvitedEmployeeId,
  employeeIdGivenToSomeoneElse,
  invitedEmployeeId,
  setInvitedEmployeeId,
  supersedeInvitedEmployeeIds,
} = await import(
  "../../src/gcli/invitedEmployeeId.js"
);
const { createCreditSubmission, invitationExtras } = await import("../../src/gcli/creditSubmission.js");
const { savePlan } = await import("../../src/gcli/companies.js");
const { readStore } = await import("../../src/gcli/devStore.js");
const { default: router } = await import("../../src/routes/enrollmentRoutes.js");

// The employee ID HR writes in the invitation file is kept with the invitation and shown filled in on
// the enrollment form; the server then enrolls the employee under it whatever the form says.

const TOKEN = "ab".repeat(32);
const give = (overrides = {}) =>
  setInvitedEmployeeId({ token: TOKEN, employeeId: "EMP-0042", employerId: "5", email: "ana@abcc.example", ...overrides });

describe("the kept employee ID", () => {
  const store = useDevStore();

  test("is found by the invitation's token, in any case", () => {
    give();

    assert.equal(invitedEmployeeId(TOKEN), "EMP-0042");
    assert.equal(invitedEmployeeId(TOKEN.toUpperCase()), "EMP-0042");
    assert.equal(invitedEmployeeId("cd".repeat(32)), null);
    assert.equal(invitedEmployeeId(undefined), null);
    assert.equal(invitedEmployeeId({ toString: () => TOKEN }), null, "only text is a token");
  });

  test("is written to the file, with whose it is", () => {
    give();

    const saved = JSON.parse(fs.readFileSync(store.file, "utf8"));
    assert.deepEqual(saved.invitedEmployeeIds[TOKEN], { employee_id_number: "EMP-0042", employer_id: "5", email: "ana@abcc.example" });
  });

  test("keeps the zeros of an ID written as text", () => {
    give({ employeeId: "000123" });
    assert.equal(invitedEmployeeId(TOKEN), "000123");
  });

  test("is nothing at all with the dev store off", () => {
    give();
    process.env.GCLI_DEV_STORE = "false";
    assert.equal(invitedEmployeeId(TOKEN), null);

    give({ token: "cd".repeat(32) });
    process.env.GCLI_DEV_STORE = "true";
    assert.equal(invitedEmployeeId("cd".repeat(32)), null, "nothing was written while it was off");
  });

  test("is another person's when an invitation of a different email carries it, in any company", () => {
    give();

    assert.equal(employeeIdGivenToSomeoneElse({ employeeId: "emp-0042", email: "jun@abcc.example" }), true, "whatever the case");
    assert.equal(employeeIdGivenToSomeoneElse({ employeeId: "EMP-0042", email: "ANA@abcc.example" }), false, "the same person invited again");
    assert.equal(
      employeeIdGivenToSomeoneElse({ employeeId: "EMP-0042", email: "ben@other.example" }),
      true,
      "another company's too: a login name is shared by every company, so two ID 1001s could not both enroll",
    );
    assert.equal(employeeIdGivenToSomeoneElse({ employeeId: "EMP-9999", email: "jun@abcc.example" }), false);
  });

  test("is free again once its invitation is taken back", () => {
    give();
    clearInvitedEmployeeId(TOKEN.toUpperCase());

    assert.equal(invitedEmployeeId(TOKEN), null);
    assert.equal(employeeIdGivenToSomeoneElse({ employeeId: "EMP-0042", email: "jun@abcc.example" }), false);
    assert.doesNotThrow(() => clearInvitedEmployeeId(TOKEN), "taking back what is not there is nothing");
    assert.doesNotThrow(() => clearInvitedEmployeeId(undefined));
  });

  test("a person invited again lets go of the old invitation's ID, and only theirs", () => {
    const old = "cd".repeat(32);
    give({ token: old, employeeId: "E-7", email: "ana@abcc.example" });
    give({ token: "ef".repeat(32), employeeId: "E-5", email: "jun@abcc.example" });
    give({ token: "12".repeat(32), employeeId: "E-3", employerId: "9", email: "ana@abcc.example" });
    give({ employeeId: "E-9", email: "ana@abcc.example" }); // the new invitation of Ana, at TOKEN

    supersedeInvitedEmployeeIds({ token: TOKEN, employerId: "5", email: "ANA@abcc.example" });

    assert.equal(invitedEmployeeId(old), null, "Ana's old one");
    assert.equal(invitedEmployeeId(TOKEN), "E-9", "the new one stays");
    assert.equal(invitedEmployeeId("ef".repeat(32)), "E-5", "Jun's");
    assert.equal(invitedEmployeeId("12".repeat(32)), "E-3", "the same email at another company is another invitation");
    assert.equal(employeeIdGivenToSomeoneElse({ employeeId: "E-7", email: "jun@abcc.example" }), false, "E-7 can go to someone else");
  });
});

describe("applyInvitedEmployeeId", () => {
  useDevStore();

  const run = (body) => {
    const req = makeReq({ body });
    const next = makeNext();
    applyInvitedEmployeeId(req, makeRes(), next);
    return { req, next };
  };

  test("makes HR's ID the enrollment's, over whatever the form sent", () => {
    give();
    const { req, next } = run({ token: TOKEN, employee_id_number: "SOMEONE-ELSE", first_name: "Ana" });

    assert.ok(next.passed());
    assert.equal(req.body.employee_id_number, "EMP-0042");
    assert.equal(req.body.first_name, "Ana", "nothing else is touched");
  });

  test("fills it in when the form sent none", () => {
    give();
    assert.equal(run({ token: TOKEN }).req.body.employee_id_number, "EMP-0042");
  });

  test("a token with a space, a line break or a non-breaking space around it is the same token", () => {
    give();

    for (const padded of [" " + TOKEN, TOKEN + "\n", "\t" + TOKEN + " ", "\u00a0" + TOKEN + "\u00a0"]) {
      const { req } = run({ token: padded, employee_id_number: "MINE" });

      assert.equal(req.body.employee_id_number, "EMP-0042", JSON.stringify(padded));
      assert.equal(req.body.token, TOKEN, "and the rest of the chain is given the token as it is");
    }
  });

  test("works on the token in any case", () => {
    give();
    assert.equal(run({ token: TOKEN.toUpperCase() }).req.body.employee_id_number, "EMP-0042");
  });

  test("leaves the form's own ID when HR gave none, and passes on a body that is no object", () => {
    assert.equal(run({ token: TOKEN, employee_id_number: "MINE" }).req.body.employee_id_number, "MINE");
    assert.equal(run({ token: "cd".repeat(32), employee_id_number: "MINE" }).req.body.employee_id_number, "MINE");
    assert.ok(run(undefined).next.passed());
    assert.ok(run("text").next.passed());
  });

  test("does nothing with the dev store off", () => {
    give();
    process.env.GCLI_DEV_STORE = "false";
    assert.equal(run({ token: TOKEN, employee_id_number: "MINE" }).req.body.employee_id_number, "MINE");
  });

  test("runs straight after the limiters on the submit, ahead of the validator and the controller", () => {
    const handlers = (method, path) =>
      router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]).route.stack.map((entry) => entry.handle);

    const submit = handlers("post", "/submit");
    assert.ok(submit.indexOf(applyInvitedEmployeeId) > -1, "it is on the submit");
    assert.ok(submit.indexOf(applyInvitedEmployeeId) < submit.length - 2, "ahead of the validator and the controller");
    assert.equal(submit.indexOf(applyInvitedEmployeeId), 2, "straight after the two limiters");
  });
});

describe("the invitation lookup and the credit submit", () => {
  useDevStore();

  const invitation = { employer_id: "5", company_name: "Abacus", email_address: "ana@abcc.example", is_valid: 1, is_enrolled: 0 };

  test("the lookup carries the ID for a standard company, and null when HR gave none", () => {
    assert.equal(invitationExtras(invitation, TOKEN).employee_id_number, null);

    give();
    assert.deepEqual(invitationExtras(invitation, TOKEN), { plan_template: "G-TLI", loan_limits: null, employee_id_number: "EMP-0042" });
  });

  test("and for a credit company", () => {
    savePlan("5", { plan: CREDIT_PLAN, loan_limits: LIMITS });
    give();

    assert.equal(invitationExtras(invitation, TOKEN).employee_id_number, "EMP-0042");
  });

  test("the lookup says nothing of it with the dev store off", () => {
    give();
    process.env.GCLI_DEV_STORE = "false";
    assert.deepEqual(invitationExtras(invitation, TOKEN), {});
  });

  test("a borrower's application is stored under HR's ID, not the one the form sent", async () => {
    savePlan("5", { plan: CREDIT_PLAN, loan_limits: LIMITS });
    give();

    const { pool } = fakePool(
      { usp_sel_enrollment_invitation_by_token: [invitation], usp_sel_employers: [{ employer_id: "5" }] },
      [[/bes\.barangay/, [{ one: 1 }]]],
    );
    const body = {
      token: TOKEN,
      employee_id_number: "TYPED-BY-THE-EMPLOYEE",
      first_name: "Ana",
      last_name: "Reyes",
      address_line: "27 Mabini St",
      nationality: "Filipino",
      tin_id: "123-456-789",
      barangay_id: "012801001",
      zip_code: "1100",
      birthplace: "Quezon City",
      birthdate: "1992-03-14",
      civil_status: "Single",
      gender: "F",
      height: 160,
      weight: 55,
      contact_no: "09171234567",
      consent_privacy: true,
      consent_terms: true,
      loan: { loan_reference: "BP-1", purpose: "Salary loan", loan_amount: 850000, term_months: 36, release_date: "2026-11-02" },
    };

    const req = makeReq({ body });
    const res = makeRes();
    const next = makeNext();
    await new Promise((resolve) => applyInvitedEmployeeId(req, res, resolve));
    await createCreditSubmission({ getPool: async () => pool })(req, res, next);

    assert.equal(res.statusCode, 201, JSON.stringify(next.calls.map((e) => e?.message)));
    assert.equal(readStore().applications[0].employee.employee_id_number, "EMP-0042");
  });
});
