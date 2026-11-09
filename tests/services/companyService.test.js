import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";
import { callTo, fakePool, inputsFor } from "../helpers/fakePool.js";

const { default: CompanyService, companyOf } = await import(
  "../../src/services/companyService.js"
);

// The Administrator's companies, DBA request 24, read back 2026-10-15. The
// procedures refuse anybody who is not an Administrator; what is tested here
// is what this side decides: the fields that leave, the 404, and how a PATCH
// becomes the whole record the procedure replaces.

const LIST = "bes.usp_sel_employers_admin";
const BY_ID = "bes.usp_sel_employer_admin_by_id";
const INSERT = "bes.usp_ins_employer";
const UPDATE = "bes.usp_upd_employer";
const DELETE = "bes.usp_del_employer";

const HR_ACCOUNTS = "sec.us08_usp_sel_hr_by_employer";

const ADMIN_ID = 1;

// Reading one company also asks for its HR accounts, which these tests do not care about unless they say.
const companyPool = (answers = {}) => fakePool({ [HR_ACCOUNTS]: [], ...answers });

// A row as usp_sel_employer_admin_by_id returns it, values as the driver hands
// them over.
const stored = (overrides = {}) => ({
  employer_id: "1",
  company_code: "Coforge",
  company_name: "Coforge BPS Philippines, Inc.",
  work_address: "Taguig City",
  office_no: "8-555-0101",
  policy_no: "G-TLI-26-136",
  status: "A",
  send_coc_email: true,
  messages_enabled: true,
  online_enrollment_max_age: null,
  created_by: "SYSTEM",
  created_date: new Date("2026-07-14T00:00:00Z"),
  modified_by: null,
  modified_date: null,
  hr_user_id: "2",
  hr_username: "hr.coforge",
  hr_email_address: "hr@coforge.example",
  active_classifications: 10,
  active_enrollments: 73,
  policy_no_locked: true,
  ...overrides,
});

describe("companyOf — what leaves", () => {
  // Pinned as a literal: this is the Administrator's company contract.
  test("answers with the named fields", () => {
    assert.deepEqual(Object.keys(companyOf(stored())).sort(), [
      "active_classifications",
      "active_enrollments",
      "company_code",
      "company_name",
      "created_by",
      "created_date",
      "employer_id",
      "hr_account",
      "messages_enabled",
      "modified_by",
      "modified_date",
      "office_no",
      "online_enrollment_max_age",
      "policy_no",
      "policy_no_locked",
      "send_coc_email",
      "status",
      "work_address",
    ]);
  });

  test("the HR account is one object, or null before branch 4 creates it", () => {
    assert.deepEqual(companyOf(stored()).hr_account, {
      user_id: "2",
      username: "hr.coforge",
      email_address: "hr@coforge.example",
    });

    assert.equal(
      companyOf(stored({ hr_user_id: null, hr_username: null, hr_email_address: null })).hr_account,
      null,
    );
  });

  test("a column a procedure gains later stays out", () => {
    const shown = companyOf(stored({ us01_password: "$2b$10$secret", affiliates: 5 }));

    assert.equal("us01_password" in shown, false);
    assert.equal("affiliates" in shown, false);
  });
});

describe("CompanyService — reading", () => {
  test("lists every company, field by field, as the caller", async () => {
    const { pool, calls } = companyPool({ [LIST]: [stored(), stored({ employer_id: "2", company_code: "HCL" })] });

    const companies = await CompanyService.getCompanies(pool, ADMIN_ID);

    assert.equal(companies.length, 2);
    assert.deepEqual(companies[0], companyOf(stored()));
    assert.equal(inputsFor(calls, LIST).us01_user_id, ADMIN_ID);
  });

  test("an id that matches no company is 404", async () => {
    const { pool } = companyPool({ [BY_ID]: [] });

    await assert.rejects(
      () => CompanyService.getCompany(pool, ADMIN_ID, "99"),
      (error) => error.statusCode === 404 && error.message === "Company not found",
    );
  });
});

// A company may have several HR accounts. The list names one of them; the company's own page lists them all, and
// says what the next one's username would be.
describe("CompanyService — a company's HR accounts", () => {
  const hr = (id, username, overrides = {}) => ({
    us01_user_id: id,
    us01_username: username,
    us01_first_name: "Maria",
    us01_middle_name: null,
    us01_last_name: "Santos",
    us01_email_address: `${username}@example.test`,
    us01_is_active: true,
    us01_is_locked: false,
    us01_must_change_password: true,
    us01_password: "$2b$10$never-leaves",
    ...overrides,
  });

  const read = async (accounts, company = {}) => {
    const { pool, calls } = companyPool({ [BY_ID]: [stored({ company_code: "COFORGE", messages_enabled: false, ...company })], [HR_ACCOUNTS]: accounts });

    return { company: await CompanyService.getCompany(pool, ADMIN_ID, "1"), calls };
  };

  test("a company with none has an empty list, and hr.<code> is the next username", async () => {
    const { company } = await read([]);

    assert.deepEqual(company.hr_accounts, []);
    assert.equal(company.next_hr_username, "hr.coforge");
  });

  test("lists every account, field by field, and nothing else a procedure returns", async () => {
    const { company } = await read([hr("2", "hr.coforge"), hr("3", "hr.coforge.2", { us01_middle_name: "D", us01_is_active: false, us01_is_locked: true })]);

    assert.deepEqual(company.hr_accounts, [
      { user_id: "2", username: "hr.coforge", first_name: "Maria", middle_name: null, last_name: "Santos", email_address: "hr.coforge@example.test", is_active: true, is_locked: false },
      { user_id: "3", username: "hr.coforge.2", first_name: "Maria", middle_name: "D", last_name: "Santos", email_address: "hr.coforge.2@example.test", is_active: false, is_locked: true },
    ]);
    assert.equal(JSON.stringify(company).includes("never-leaves"), false);
  });

  test("the next username is the first number the company has not used", async () => {
    assert.equal((await read([hr("2", "hr.coforge")])).company.next_hr_username, "hr.coforge.2");
    assert.equal((await read([hr("2", "hr.coforge"), hr("3", "hr.coforge.2")])).company.next_hr_username, "hr.coforge.3");
    assert.equal((await read([hr("3", "hr.coforge.2")])).company.next_hr_username, "hr.coforge", "a gap is filled");
  });

  test("asks the procedure for this company, as the caller", async () => {
    const { calls } = await read([]);

    assert.equal(inputsFor(calls, HR_ACCOUNTS).employer_id, "1");
    assert.equal(inputsFor(calls, HR_ACCOUNTS).us01_user_id, ADMIN_ID);
  });

  test("the list's one-account `hr_account` is still there for the Companies list", async () => {
    const { company } = await read([hr("2", "hr.coforge")], { hr_user_id: "2", hr_username: "hr.coforge", hr_email_address: "hr@coforge.example" });

    assert.deepEqual(company.hr_account, { user_id: "2", username: "hr.coforge", email_address: "hr@coforge.example" });
  });
});

// The page that switches messaging on and off reads ONE company. On 2026-10-28
// bes.usp_sel_employer_admin_by_id returned no messages_enabled at all, though
// the list returns it, and the page answered "not available from the server
// yet". And the column is NULL on every company until somebody switches it,
// which the page also read as "not available".
describe("CompanyService — the messaging switch", () => {
  // The single-company row as the database really answers: without the column.
  const withoutColumn = () => {
    const { messages_enabled, ...row } = stored();
    return row;
  };

  test("a company read without the column gets it from the list", async () => {
    const { pool, calls } = companyPool({
      [BY_ID]: [withoutColumn()],
      [LIST]: [stored({ employer_id: "2", messages_enabled: false }), stored({ messages_enabled: true })],
    });

    const company = await CompanyService.getCompany(pool, ADMIN_ID, "1");

    assert.equal(company.messages_enabled, true);
    assert.equal(inputsFor(calls, LIST).us01_user_id, ADMIN_ID);
  });

  test("it takes the row for THIS company, not the first in the list", async () => {
    const { pool } = companyPool({
      [BY_ID]: [withoutColumn()],
      [LIST]: [stored({ employer_id: "2", messages_enabled: true }), stored({ employer_id: "1", messages_enabled: false })],
    });

    assert.equal((await CompanyService.getCompany(pool, ADMIN_ID, "1")).messages_enabled, false);
  });

  test("NULL, which is every company until it is switched, is off", async () => {
    const { pool } = companyPool({
      [BY_ID]: [withoutColumn()],
      [LIST]: [stored({ messages_enabled: null })],
    });

    assert.strictEqual((await CompanyService.getCompany(pool, ADMIN_ID, "1")).messages_enabled, false);
  });

  test("a company that is not in the list stays unknown, not guessed off", async () => {
    const { pool } = companyPool({ [BY_ID]: [withoutColumn()], [LIST]: [] });

    assert.strictEqual((await CompanyService.getCompany(pool, ADMIN_ID, "1")).messages_enabled, undefined);
  });

  test("once the procedure returns the column, the list is not asked", async () => {
    const { pool, calls } = companyPool({ [BY_ID]: [stored({ messages_enabled: true })] });

    const company = await CompanyService.getCompany(pool, ADMIN_ID, "1");

    assert.equal(company.messages_enabled, true);
    assert.equal(calls.some((call) => call.procedure === LIST), false);
  });

  test("and a NULL it returns is off too", async () => {
    const { pool } = companyPool({ [BY_ID]: [stored({ messages_enabled: null })] });

    assert.strictEqual((await CompanyService.getCompany(pool, ADMIN_ID, "1")).messages_enabled, false);
  });

  test("the list answers off for NULL as well", async () => {
    const { pool } = companyPool({ [LIST]: [stored({ messages_enabled: null })] });

    assert.strictEqual((await CompanyService.getCompanies(pool, ADMIN_ID))[0].messages_enabled, false);
  });

  test("a bit that arrives as 1 or \"1\" is on", () => {
    assert.strictEqual(companyOf(stored({ messages_enabled: 1 })).messages_enabled, true);
    assert.strictEqual(companyOf(stored({ messages_enabled: "1" })).messages_enabled, true);
    assert.strictEqual(companyOf(stored({ messages_enabled: 0 })).messages_enabled, false);
  });
});

describe("CompanyService — creating", () => {
  const abcc = {
    company_code: "ABCC",
    company_name: "Abacus Book and Card Corporation",
    work_address: "Mandaluyong City",
    office_no: null,
    policy_no: "G-TLI-26-177",
    send_coc_email: true,
    online_enrollment_max_age: 65,
  };

  test("sends the company as the caller, and answers it as stored", async () => {
    const { pool, calls } = companyPool({
      [INSERT]: [{ employer_id: "5" }],
      [BY_ID]: ({ employer_id }) => ({ recordset: [stored({ employer_id, company_code: "ABCC" })], output: {} }),
    });

    const created = await CompanyService.createCompany(pool, ADMIN_ID, { ...abcc });

    const sent = inputsFor(calls, INSERT);
    assert.equal(sent.us01_user_id, ADMIN_ID);
    assert.equal(sent.created_by, String(ADMIN_ID));
    for (const [field, value] of Object.entries(abcc)) assert.equal(sent[field], value, field);

    // Read back by the id the procedure returned.
    assert.equal(inputsFor(calls, BY_ID).employer_id, "5");
    assert.equal(created.employer_id, "5");
  });
});

describe("CompanyService — a PATCH becomes the whole company", () => {
  const editing = (row = stored()) =>
    companyPool({
      [BY_ID]: row === null ? [] : [row],
      [UPDATE]: [{ employer_id: "1" }],
    });

  // The procedure replaces every field, so what was not sent must go back as
  // it is stored, or the PATCH would blank it.
  test("the fields not sent go back as stored; the ones sent replace them", async () => {
    const { pool, calls } = editing();

    await CompanyService.updateCompany(pool, ADMIN_ID, "1", { work_address: "Pasig City" });

    const sent = inputsFor(calls, UPDATE);
    assert.equal(sent.work_address, "Pasig City");
    assert.equal(sent.company_code, "Coforge");
    assert.equal(sent.company_name, "Coforge BPS Philippines, Inc.");
    assert.equal(sent.office_no, "8-555-0101");
    assert.equal(sent.policy_no, "G-TLI-26-136");
    assert.equal(sent.send_coc_email, true);
    assert.equal(sent.online_enrollment_max_age, null);
    assert.equal(sent.employer_id, "1");
    assert.equal(sent.modified_by, String(ADMIN_ID));
  });

  // null is a value here: the field was sent, to clear it.
  test("a field sent as null clears it rather than keeping the stored value", async () => {
    const { pool, calls } = editing(stored({ online_enrollment_max_age: 65 }));

    await CompanyService.updateCompany(pool, ADMIN_ID, "1", { office_no: null, online_enrollment_max_age: null });

    const sent = inputsFor(calls, UPDATE);
    assert.equal(sent.office_no, null);
    assert.equal(sent.online_enrollment_max_age, null);
  });

  // Only the seven editable company fields are sent; the settings extension
  // is saved through the dedicated settings route, not the company form.
  // The counts and the HR account
  // from the stored row are not the procedure's business.
  test("sends company form fields and nothing read alongside them", async () => {
    const { pool, calls } = editing();

    await CompanyService.updateCompany(pool, ADMIN_ID, "1", { company_name: "Coforge" });

    assert.deepEqual(Object.keys(inputsFor(calls, UPDATE)).sort(), [
      "company_code",
      "company_name",
      "employer_id",
      "modified_by",
      "office_no",
      "online_enrollment_max_age",
      "policy_no",
      "send_coc_email",
      "us01_user_id",
      "work_address",
    ]);
  });

  test("a company that does not exist is 404, and nothing is written", async () => {
    const { pool, calls } = editing(null);

    await assert.rejects(
      () => CompanyService.updateCompany(pool, ADMIN_ID, "99", { work_address: "Pasig City" }),
      (error) => error.statusCode === 404 && error.message === "Company not found",
    );
    assert.equal(callTo(calls, UPDATE), undefined);
  });
});

// Branch 10, DBA request 25 Part 10. The procedure decides everything: whether
// the company exists (50187) and whether anything belongs to it (50212).
describe("CompanyService — deleting", () => {
  test("asks the procedure as the caller, for that company", async () => {
    const { pool, calls } = companyPool({ [DELETE]: [{ employer_id: "9" }] });

    await CompanyService.deleteCompany(pool, ADMIN_ID, "9");

    assert.deepEqual(inputsFor(calls, DELETE), { us01_user_id: ADMIN_ID, employer_id: "9" });
  });

  // Nothing is read first: a check here would race the procedure's own.
  test("reads nothing else first", async () => {
    const { pool, calls } = companyPool({ [DELETE]: [{ employer_id: "9" }] });

    await CompanyService.deleteCompany(pool, ADMIN_ID, "9");

    assert.deepEqual(calls.map((call) => call.procedure), [DELETE]);
  });

  test("the procedure's refusal reaches the caller as it was thrown", async () => {
    const refusal = Object.assign(new Error("Company cannot be deleted while anything belongs to it."), { number: 50212 });
    const { pool } = companyPool({
      [DELETE]: () => {
        throw refusal;
      },
    });

    await assert.rejects(() => CompanyService.deleteCompany(pool, ADMIN_ID, "1"), (error) => error === refusal);
  });
});
