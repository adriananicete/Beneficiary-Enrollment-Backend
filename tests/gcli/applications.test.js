import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  applicationDetails,
  applicationOfToken,
  decideApplication,
  editApplication,
  getApplication,
  isApplicationId,
  listApplications,
  pendingApplicationCount,
  submitApplication,
  withApplications,
} from "../../src/gcli/applications.js";
import { savePlan } from "../../src/gcli/companies.js";
import { readStore } from "../../src/gcli/devStore.js";
import { CREDIT_PLAN, LIMITS, useDevStore } from "../helpers/gcliStore.js";

const NOW = new Date("2026-10-27T03:00:00.000Z");
const HR = ["2"];

const tokenOf = (letter) => letter.repeat(64);

const invitation = (overrides = {}) => ({
  employer_id: "2",
  company_name: "Bluepoint Lending Corporation",
  email_address: "ana.reyes@bluepoint.example",
  ...overrides,
});

const form = (overrides = {}) => ({
  token: tokenOf("a"),
  employee_id_number: "EMP-2201",
  first_name: "Ana",
  middle_name: "Marie",
  last_name: "Reyes",
  suffix: "",
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
  office_no: null,
  consent_privacy: true,
  consent_terms: true,
  loan: { loan_reference: "BP-2026-004187", purpose: "Salary loan", loan_amount: 850000, term_months: 36, release_date: "2026-11-02" },
  ...overrides,
});

const submit = (overrides, inv = invitation(), extra = {}) =>
  submitApplication({ invitation: inv, body: form(overrides), now: NOW, ...extra });

const clientIdOf = (n = 1) => String(900_000_000_000 + n);

describe("a borrower's application", () => {
  useDevStore();
  beforeEach(() => savePlan("2", { plan: CREDIT_PLAN, loan_limits: LIMITS }));

  test("is stored as pending, with a number, and the company and email are the invitation's", () => {
    const answer = submit({ email_address: "someone.else@example.com", employer_id: "99" });

    assert.deepEqual(answer, { application_no: "GCLI-2026-0001", status: "pending" });

    const stored = readStore().applications[0];
    assert.equal(stored.client_id, clientIdOf(1));
    assert.equal(stored.employer_id, "2");
    assert.equal(stored.employee.email_address, "ana.reyes@bluepoint.example");
    assert.equal(stored.status, "pending");
    assert.equal(stored.token, tokenOf("a"));
    assert.deepEqual(stored.loan, { loan_reference: "BP-2026-004187", purpose: "Salary loan", loan_amount: 850000, term_months: 36, release_date: "2026-11-02" });
    assert.deepEqual(stored.history.map((entry) => entry.action), ["submitted"]);
  });

  test("keeps no classification, beneficiaries, employment or consent", () => {
    submit({ classification_id: 3, beneficiaries: [{ full_name: "x" }], sss_gsis_no: "1", position_title: "p", source_of_income: "s", occupation: "o" });

    const stored = readStore().applications[0];
    for (const field of ["classification_id", "beneficiaries", "sss_gsis_no", "position_title", "source_of_income", "occupation", "consent_privacy"])
      assert.equal(field in stored.employee, false, field);
  });

  test("numbers go up one at a time and are not reused", () => {
    submit();
    assert.equal(submit({ token: tokenOf("b"), employee_id_number: "EMP-2" }).application_no, "GCLI-2026-0002");
    assert.equal(submit({ token: tokenOf("c"), employee_id_number: "EMP-3" }).application_no, "GCLI-2026-0003");
    assert.deepEqual(readStore().applications.map((a) => a.client_id), [clientIdOf(1), clientIdOf(2), clientIdOf(3)]);
  });

  test("the same link cannot send a second one", () => {
    submit();
    assert.throws(() => submit(), { statusCode: 409, message: "You have already submitted an enrollment" });
    assert.equal(readStore().applications.length, 1);
  });

  test("another borrower cannot use the same employee ID number", () => {
    submit();
    assert.throws(() => submit({ token: tokenOf("b") }), { statusCode: 409, message: "Employee ID number already exists" });
  });

  test("a loan outside the company's limits is 422 with every reason, and nothing is stored", () => {
    const refusal = (loan) => {
      try {
        submit({ loan: { ...form().loan, ...loan } });
      } catch (error) {
        return error;
      }
    };

    const error = refusal({ loan_amount: 6200000, term_months: 72 });
    assert.equal(error.statusCode, 422);
    assert.equal(
      error.message,
      "Bluepoint Lending Corporation covers loans up to PHP 5,000,000. Bluepoint Lending Corporation covers terms up to 60 months.",
    );
    assert.deepEqual(readStore().applications, []);
    assert.equal(readStore().lastApplication, 0, "a refused application uses up no number");
  });

  test("the borrower's age at entry and at the end of the loan are held to the company's limits", () => {
    assert.throws(() => submit({ birthdate: "2010-01-01" }), { statusCode: 422, message: /aged 18 to 65/ });
    assert.throws(() => submit({ birthdate: "1950-01-01" }), { statusCode: 422, message: /aged 18 to 65/ });
  });

  test("a link in another case, or an employee ID in another case, is the same link and the same person", () => {
    submit({ token: "ab".repeat(32), employee_id_number: "EMP-Abc" });

    assert.throws(() => submit({ token: "AB".repeat(32) }), { statusCode: 409, message: /already submitted/ });
    assert.throws(() => submit({ token: "cd".repeat(32), employee_id_number: "emp-ABC" }), { statusCode: 409, message: /already exists/ });
    assert.equal(applicationOfToken("AB".repeat(32)).application_no, "GCLI-2026-0001");
  });

  test("a company with no loan limits yet cannot take applications", () => {
    savePlan("2", { loan_limits: null });
    assert.throws(() => submit(), { statusCode: 409, message: /has not set its loan limits/ });
  });

  test("a returned application is corrected on the same link and goes back to pending", () => {
    submit();
    decideApplication({ clientId: clientIdOf(1), employerIds: HR, action: "return", note: "Check the reference", by: "hr.bluepoint", now: NOW });
    assert.equal(applicationOfToken(tokenOf("a")).status, "returned");

    const answer = submit({ loan: { ...form().loan, loan_reference: "BP-2026-009999" } });

    assert.deepEqual(answer, { application_no: "GCLI-2026-0001", status: "pending" }, "the same application, the same number");
    const stored = readStore().applications;
    assert.equal(stored.length, 1);
    assert.equal(stored[0].status, "pending");
    assert.equal(stored[0].loan.loan_reference, "BP-2026-009999");
    assert.deepEqual(stored[0].history.map((entry) => entry.action), ["submitted", "returned", "submitted"]);
  });

  test("the PUT needs a returned application to correct", () => {
    assert.throws(() => submit({}, invitation(), { resubmit: true }), { statusCode: 409, message: /no returned application/ });

    submit();
    assert.throws(() => submit({}, invitation(), { resubmit: true }), { statusCode: 409, message: /already submitted/ }, "it is still waiting");

    decideApplication({ clientId: clientIdOf(1), employerIds: HR, action: "return", note: "n", by: "hr", now: NOW });
    assert.equal(submit({}, invitation(), { resubmit: true }).status, "pending");
  });

  test("a rejected application is final, and frees the employee ID number", () => {
    submit();
    decideApplication({ clientId: clientIdOf(1), employerIds: HR, action: "reject", note: "Not covered", by: "hr", now: NOW });

    assert.throws(() => submit(), { statusCode: 409 }, "the same link cannot try again");
    assert.equal(submit({ token: tokenOf("b") }).application_no, "GCLI-2026-0002", "but the number can be used on another");
  });

  test("an application's id is told apart from an enrollment's", () => {
    assert.equal(isApplicationId(clientIdOf(1)), true);
    for (const id of ["1", "12345", "899999999999", "1800000000000", "abc", "", undefined, "900000000001x"])
      assert.equal(isApplicationId(id), false, String(id));
  });
});

describe("HR's queue", () => {
  useDevStore();
  beforeEach(() => {
    savePlan("2", { plan: CREDIT_PLAN, loan_limits: LIMITS });
    submit();
    submit({ token: tokenOf("b"), employee_id_number: "EMP-2", first_name: "Paolo", middle_name: "", last_name: "Dizon", loan: { ...form().loan, loan_amount: 1250000 } }, invitation({ email_address: "pdizon@bluepoint.example" }), { now: new Date("2026-10-27T04:00:00.000Z") });
    // a company of another HR
    savePlan("7", { plan: CREDIT_PLAN, loan_limits: LIMITS });
    submit({ token: tokenOf("c"), employee_id_number: "EMP-3" }, invitation({ employer_id: "7", company_name: "Other Lending" }));
  });

  const list = (tab = "waiting", employerIds = HR, paging = {}) => listApplications({ employerIds, tab, page: 1, pageSize: 25, ...paging });

  test("lists the waiting applications of HR's company only, newest first", () => {
    const page = list();

    assert.deepEqual(page.rows.map((row) => row.employee_name), ["Paolo Dizon", "Ana Marie Reyes"]);
    assert.equal(page.total, 2);
    assert.equal(page.totalPages, 1);
    assert.deepEqual(Object.keys(page.rows[0]).sort(), [
      "above_no_medical_limit", "application_no", "client_id", "email_address", "employee_id_number", "employee_name",
      "loan_amount", "loan_reference", "status", "submitted_date", "term_months",
    ]);
    assert.equal(page.rows[0].above_no_medical_limit, true, "1,250,000 is above the 1,000,000 no-medical limit");
    assert.equal(page.rows[1].above_no_medical_limit, false);
  });

  test("each tab lists its own status", () => {
    decideApplication({ clientId: clientIdOf(1), employerIds: HR, action: "approve", effectivityDate: "2026-11-02", by: "hr", now: NOW });
    decideApplication({ clientId: clientIdOf(2), employerIds: HR, action: "return", note: "n", by: "hr", now: NOW });

    assert.deepEqual([list("waiting").total, list("returned").total, list("approved").total, list("rejected").total], [0, 1, 1, 0]);
    assert.equal(list("approved").rows[0].status, "approved");
  });

  test("pages by the size asked for", () => {
    const first = list("waiting", HR, { page: 1, pageSize: 1 });
    const second = list("waiting", HR, { page: 2, pageSize: 1 });

    assert.deepEqual([first.rows.length, second.rows.length, first.totalPages], [1, 1, 2]);
    assert.notEqual(first.rows[0].client_id, second.rows[0].client_id);
  });

  test("a company that is not HR's is not seen, and a tab that does not exist is 400", () => {
    assert.equal(list("waiting", ["99"]).total, 0);
    assert.equal(list("waiting", ["2", "7"]).total, 3);
    assert.throws(() => list("everything"), { statusCode: 400 });
    for (const inherited of ["constructor", "__proto__", "toString"]) assert.throws(() => list(inherited), { statusCode: 400 }, inherited);
  });

  test("counts the waiting ones for the menu", () => {
    assert.equal(pendingApplicationCount(HR), 2);
    decideApplication({ clientId: clientIdOf(1), employerIds: HR, action: "return", note: "n", by: "hr", now: NOW });
    assert.equal(pendingApplicationCount(HR), 1);
    assert.equal(pendingApplicationCount(["99"]), 0);
  });

  test("the whole application has the shape the Review window reads, and no classification", () => {
    const application = getApplication(clientIdOf(1), HR);

    assert.deepEqual(Object.keys(application).sort(), [
      "application_no", "client_id", "company_name", "creditor_name", "employee", "history", "loan", "loan_limits", "status", "submitted_date",
    ]);
    assert.deepEqual(application.employee, {
      full_name: "Ana Marie Reyes",
      birthdate: "1992-03-14",
      employee_id_number: "EMP-2201",
      email_address: "ana.reyes@bluepoint.example",
      contact_no: "09171234567",
      office_no: null,
      address_line: "27 Mabini St",
    });
    assert.deepEqual(application.loan_limits, LIMITS);
    assert.equal(application.creditor_name, "Bluepoint Lending Corporation");
    assert.equal("effectivity_date" in application, false, "none until it is approved");
  });

  test("another company's application, and an id that is no application's, are 404", () => {
    assert.throws(() => getApplication(clientIdOf(3), HR), { statusCode: 404 });
    assert.throws(() => getApplication(clientIdOf(99), HR), { statusCode: 404 });
    assert.throws(() => getApplication("12", HR), { statusCode: 404 });
  });
});

describe("HR edits an application", () => {
  useDevStore();
  beforeEach(() => {
    savePlan("2", { plan: CREDIT_PLAN, loan_limits: LIMITS });
    submit();
  });

  const edit = (changes, reason = "Typo in the contact number", employerIds = HR) =>
    editApplication({ clientId: clientIdOf(1), employerIds, changes, reason, by: "hr.bluepoint", now: NOW });

  test("changes the contact and the loan, and the answer is the application", () => {
    const answer = edit({ contact_no: "09181234567", office_no: "02-8123-4567", address_line: "1 New St", loan: { loan_reference: "BP-2026-000001", loan_amount: 900000 } });

    assert.equal(answer.employee.contact_no, "09181234567");
    assert.equal(answer.employee.office_no, "02-8123-4567");
    assert.equal(answer.employee.address_line, "1 New St");
    assert.equal(answer.loan.loan_reference, "BP-2026-000001");
    assert.equal(answer.loan.loan_amount, 900000);
    assert.equal(answer.loan.term_months, 36, "what was not sent stays");
  });

  test("records before and after for each field, with the reason, in the history", () => {
    edit({ contact_no: "09181234567", loan: { loan_amount: 900000 } });

    const entry = getApplication(clientIdOf(1), HR).history.at(-1);
    assert.equal(entry.action, "edited");
    assert.equal(entry.by, "hr.bluepoint");
    assert.equal(entry.note, "Typo in the contact number");
    assert.deepEqual(entry.changes, [
      { field: "contact_no", before: "09171234567", after: "09181234567" },
      { field: "loan.loan_amount", before: 850000, after: 900000 },
    ]);
  });

  test("an office number is cleared with null", () => {
    edit({ office_no: "02-8123-4567" });
    assert.equal(edit({ office_no: null }).employee.office_no, null);
  });

  test("a reason is required, and not longer than 500 characters", () => {
    for (const reason of [null, "", "   ", 5]) assert.throws(() => edit({ contact_no: "09181234567" }, reason), { statusCode: 400 }, String(reason));
    assert.throws(() => edit({ contact_no: "09181234567" }, "x".repeat(501)), { statusCode: 400 });
    assert.doesNotThrow(() => edit({ contact_no: "09181234567" }, "x".repeat(500)));
  });

  test("the borrower's own name, birth date and email cannot be edited", () => {
    for (const field of ["first_name", "last_name", "birthdate", "email_address", "employee_id_number", "status"])
      assert.throws(() => edit({ [field]: "x" }), { statusCode: 400, message: `${field} cannot be changed here` }, field);
  });

  test("a loan field that does not exist, or is not a number or date, is 400", () => {
    assert.throws(() => edit({ loan: { balance: 1 } }), { statusCode: 400, message: "balance is not a loan field" });
    assert.throws(() => edit({ loan: { loan_amount: "lots" } }), { statusCode: 400 });
    assert.throws(() => edit({ loan: { term_months: 1.5 } }), { statusCode: 400 });
    assert.throws(() => edit({ loan: { release_date: "2026-02-30" } }), { statusCode: 400 });
    assert.throws(() => edit({ loan: { loan_reference: "" } }), { statusCode: 400 });
    assert.throws(() => edit({ contact_no: "123" }), { statusCode: 400 });
    assert.throws(() => edit({ address_line: " " }), { statusCode: 400 });
  });

  test("a loan edited outside the company's limits is 422 and nothing changes", () => {
    assert.throws(() => edit({ loan: { loan_amount: 6200000 } }), { statusCode: 422, message: /up to PHP 5,000,000/ });
    assert.equal(getApplication(clientIdOf(1), HR).loan.loan_amount, 850000);
    assert.equal(getApplication(clientIdOf(1), HR).history.length, 1);
  });

  test("an edit that changes nothing is 400", () => {
    assert.throws(() => edit({ contact_no: "09171234567" }), { statusCode: 400, message: "Nothing to change" });
    assert.throws(() => edit({}), { statusCode: 400 });
    assert.throws(() => edit(null), { statusCode: 400 });
  });

  test("only a waiting application can be edited, and only by the HR of its company", () => {
    assert.throws(() => edit({ contact_no: "09181234567" }, "r", ["99"]), { statusCode: 404 });

    decideApplication({ clientId: clientIdOf(1), employerIds: HR, action: "return", note: "n", by: "hr", now: NOW });
    assert.throws(() => edit({ contact_no: "09181234567" }), { statusCode: 409, message: "Only a waiting application can be edited" });
  });
});

describe("HR decides", () => {
  useDevStore();
  beforeEach(() => {
    savePlan("2", { plan: CREDIT_PLAN, loan_limits: LIMITS });
    submit();
  });

  const decide = (action, rest = {}) => decideApplication({ clientId: clientIdOf(1), employerIds: HR, action, by: "hr.bluepoint", now: NOW, ...rest });

  test("approving sets the day the cover starts and the day the loan ends, and makes no login", () => {
    assert.deepEqual(decide("approve", { effectivityDate: "2026-11-02" }), { client_id: clientIdOf(1), status: "approved" });

    const application = getApplication(clientIdOf(1), HR);
    assert.equal(application.status, "approved");
    assert.equal(application.effectivity_date, "2026-11-02");
    assert.equal(readStore().applications[0].maturity_date, "2029-11-02");
    assert.equal(application.history.at(-1).action, "approved");
  });

  test("a day already past is allowed, and a day that is not a date is 400", () => {
    assert.doesNotThrow(() => decide("approve", { effectivityDate: "2026-01-01" }));
  });

  test("approving needs a real date", () => {
    for (const effectivityDate of [undefined, "", "soon", "2026-02-30", 20261102])
      assert.throws(() => decide("approve", { effectivityDate }), { statusCode: 400 }, String(effectivityDate));
    assert.equal(getApplication(clientIdOf(1), HR).status, "pending");
  });

  test("approving checks the loan against the company's limits as they are now", () => {
    savePlan("2", { loan_limits: { ...LIMITS, max_loan: 800000 } });

    assert.throws(() => decide("approve", { effectivityDate: "2026-11-02" }), { statusCode: 422, message: /up to PHP 800,000/ });
    assert.equal(getApplication(clientIdOf(1), HR).status, "pending");
  });

  test("with the limits cleared since the borrower applied, it is not approved on trust", () => {
    savePlan("2", { loan_limits: null });

    assert.throws(() => decide("approve", { effectivityDate: "2026-11-02" }), { statusCode: 409, message: /has not set its loan limits/ });
    assert.equal(getApplication(clientIdOf(1), HR).status, "pending");
    assert.equal(decide("return", { note: "Wait for the limits" }).status, "returned", "HR can still answer it");
  });

  test("returning and rejecting need a note for the borrower", () => {
    for (const action of ["return", "reject"]) {
      for (const note of [undefined, "", "  ", "x".repeat(501)]) assert.throws(() => decide(action, { note }), { statusCode: 400 }, `${action} ${note}`);
    }
    assert.equal(getApplication(clientIdOf(1), HR).status, "pending");

    assert.equal(decide("return", { note: "Check the loan reference" }).status, "returned");
    const entry = getApplication(clientIdOf(1), HR).history.at(-1);
    assert.deepEqual([entry.action, entry.note, entry.by], ["returned", "Check the loan reference", "hr.bluepoint"]);
  });

  test("rejecting is final", () => {
    assert.equal(decide("reject", { note: "Not covered" }).status, "rejected");
    assert.throws(() => decide("approve", { effectivityDate: "2026-11-02" }), { statusCode: 409, message: "This application has already been decided" });
    assert.throws(() => decide("return", { note: "n" }), { statusCode: 409 });
  });

  test("a decision is made once", () => {
    decide("approve", { effectivityDate: "2026-11-02" });
    assert.throws(() => decide("approve", { effectivityDate: "2026-12-01" }), { statusCode: 409 });
    assert.equal(getApplication(clientIdOf(1), HR).effectivity_date, "2026-11-02");
  });

  test("only the HR of the company decides", () => {
    assert.throws(() => decide("reject", { note: "n", employerIds: ["99"] }), { statusCode: 404 });
    assert.equal(getApplication(clientIdOf(1), HR).status, "pending");
  });
});

describe("the Dashboard", () => {
  useDevStore();
  beforeEach(() => {
    savePlan("2", { plan: CREDIT_PLAN, loan_limits: LIMITS });
    submit();
    submit({ token: tokenOf("b"), employee_id_number: "EMP-9", first_name: "Paolo", last_name: "Dizon" }, invitation({ email_address: "pdizon@bluepoint.example" }), { now: new Date("2026-10-27T04:00:00.000Z") });
    decideApplication({ clientId: clientIdOf(1), employerIds: HR, action: "approve", effectivityDate: "2026-11-02", by: "hr", now: NOW });
  });

  const page = (rows = [{ client_id: "41", first_name: "Old", last_name: "Timer", status: "A" }], extra = {}) => ({
    rows,
    page: 1,
    pageSize: 25,
    total: rows.length,
    totalPages: 1,
    ...extra,
  });

  test("applications come before the enrollments, as P, R, X and A, with the loan and the day the cover starts", () => {
    const merged = withApplications(page(), { employerIds: HR });

    assert.deepEqual(merged.rows.map((row) => [row.first_name, row.status]), [["Paolo", "P"], ["Ana", "A"], ["Old", "A"]]);
    assert.equal(merged.total, 3);

    const approved = merged.rows[1];
    assert.equal(approved.client_id, clientIdOf(1));
    assert.equal(approved.enrollment_id, null);
    assert.equal(approved.loan_amount, 850000);
    assert.equal(approved.effectivity_date, "2026-11-02");
    assert.equal(approved.enrollment_date, "2026-10-27");
    assert.equal(approved.classification_desc, null, "a borrower is not classified");
    assert.equal(merged.rows[0].effectivity_date, null);
  });

  test("returned and rejected show as R and X", () => {
    decideApplication({ clientId: clientIdOf(2), employerIds: HR, action: "return", note: "n", by: "hr", now: NOW });
    assert.equal(withApplications(page([]), { employerIds: HR }).rows[0].status, "R");

    savePlan("2", { loan_limits: LIMITS });
    submit({ token: tokenOf("c"), employee_id_number: "EMP-3" });
    decideApplication({ clientId: clientIdOf(3), employerIds: HR, action: "reject", note: "n", by: "hr", now: NOW });
    assert.ok(withApplications(page([]), { employerIds: HR }).rows.some((row) => row.status === "X"));
  });

  test("they ride on the first page only, and the total counts them", () => {
    const second = withApplications(page([{ client_id: "42" }], { page: 2, total: 26, totalPages: 2 }), { employerIds: HR });

    assert.deepEqual(second.rows, [{ client_id: "42" }]);
    assert.equal(second.total, 28);
    assert.equal(second.totalPages, 2);
  });

  test("applications add no page of their own, so the last page is never empty", () => {
    // 25 enrollments fill page 1 of 25; three applications ride on it
    const full = withApplications(page(Array.from({ length: 25 }, (_, i) => ({ client_id: String(i) })), { total: 25 }), { employerIds: HR });

    assert.equal(full.rows.length, 27);
    assert.equal(full.total, 27);
    assert.equal(full.totalPages, 1);

    // no enrollments at all, only applications: still one page
    assert.equal(withApplications(page([], { total: 0, totalPages: 0 }), { employerIds: HR }).totalPages, 1);
  });

  test("the day it was sent is the Philippine day, not the UTC one", () => {
    const saved = process.env.TZ;
    process.env.TZ = "Asia/Manila";
    try {
      // 07:30 on 28 October in Manila is still 27 October in UTC
      submit({ token: tokenOf("d"), employee_id_number: "EMP-7" }, invitation(), { now: new Date("2026-10-27T23:30:00.000Z") });

      const row = withApplications(page([]), { employerIds: HR }).rows.find((r) => r.employee_id_number === "EMP-7");
      assert.equal(row.enrollment_date, "2026-10-28");
    } finally {
      if (saved === undefined) delete process.env.TZ;
      else process.env.TZ = saved;
    }
  });

  test("the page is returned as it was when HR's companies have none", () => {
    const original = page();
    assert.equal(withApplications(original, { employerIds: ["99"] }), original);
  });

  test("a search narrows them by name, employee ID or email", () => {
    for (const search of ["paolo", "EMP-9", "pdizon@"]) {
      const rows = withApplications(page([]), { employerIds: HR, search }).rows;
      assert.deepEqual(rows.map((row) => row.first_name), ["Paolo"], search);
    }
    assert.equal(withApplications(page(), { employerIds: HR, search: "nobody" }).rows.length, 1, "only the real enrollment is left");
  });

  test("View Details answers for an application, with no enrollment and no beneficiaries", () => {
    const details = applicationDetails(clientIdOf(1), HR);

    assert.equal(details.enrollment.length, 1);
    assert.equal(details.enrollment[0].enrollment_id, null);
    assert.equal(details.enrollment[0].loan_reference, "BP-2026-004187");
    assert.equal(details.enrollment[0].maturity_date, "2029-11-02");
    assert.equal(details.enrollment[0].plan_template, "G-CLI");
    assert.deepEqual([details.beneficiaries, details.benefits], [[], []]);
    assert.throws(() => applicationDetails(clientIdOf(1), ["99"]), { statusCode: 404 });
  });
});
