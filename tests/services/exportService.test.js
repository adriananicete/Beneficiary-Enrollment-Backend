import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";
import { fakePool, inputsFor } from "../helpers/fakePool.js";

const { buildEnrollmentReport } = await import(
  "../../src/services/exportService.js"
);

// The Excel report had no test at all until the pool was injected: it called
// getPool() itself, so reaching it meant reaching the database.
//
// The assertions below are on the workbook rather than on private helpers.
// parseRange, withinRange and buildRows are not exported, and testing them
// through the file the user actually downloads is the point — a row that is
// built correctly and never written is not a passing result.

const HEADER_ROW = 4;
const FIRST_DATA_ROW = 5;

const COLUMN = {
  company: 1,
  employeeNo: 2,
  employeeName: 3,
  email: 4,
  status: 5,
  beneficiary: 6,
  relationship: 7,
  age: 8,
  coverage: 9,
};

const employee = (overrides = {}) => ({
  client_id: 1,
  enrollment_id: 11,
  company_name: "Coforge",
  employee_id_number: "EMP-020",
  first_name: "Ana",
  middle_name: "",
  last_name: "Reyes",
  suffix: "",
  email_address: "ana.reyes@coforge.com",
  status: "A",
  enrollment_date: "2026-03-15T14:30:00",
  ...overrides,
});

const beneficiary = (overrides = {}) => ({
  enrollment_id: 11,
  full_name: "Juan Reyes",
  relationship: "Child",
  age: 9,
  coverage_percent: 100,
  ...overrides,
});

const report = async (employees, beneficiaries = [], range = {}) => {
  const { pool, calls } = fakePool({
    usp_sel_hr_employees: employees,
    usp_sel_beneficiaries_by_enrollments: beneficiaries,
  });

  const result = await buildEnrollmentReport(pool, 7, range);
  const sheet = result.workbook.getWorksheet("Enrollments");

  const cell = (row, column) => sheet.getCell(row, COLUMN[column]).value;

  return { ...result, sheet, cell, calls };
};

describe("exportService — the report itself", () => {
  test("writes one row per beneficiary, with the employee columns repeated", async () => {
    const { cell, rowCount, employeeCount } = await report(
      [employee()],
      [
        beneficiary({ full_name: "Juan Reyes", coverage_percent: 60 }),
        beneficiary({ full_name: "Maria Reyes", coverage_percent: 40 }),
      ],
    );

    assert.equal(employeeCount, 1);
    assert.equal(rowCount, 2);

    assert.equal(cell(FIRST_DATA_ROW, "beneficiary"), "Juan Reyes");
    assert.equal(cell(FIRST_DATA_ROW + 1, "beneficiary"), "Maria Reyes");

    // Repeated rather than merged. Merging looks tidier and breaks sorting and
    // pivoting, which is the entire reason for a flat export.
    assert.equal(cell(FIRST_DATA_ROW, "employeeNo"), "EMP-020");
    assert.equal(cell(FIRST_DATA_ROW + 1, "employeeNo"), "EMP-020");
  });

  // This is the "who has nominated nobody" report, and it comes free — but only
  // because the row is emitted with the right-hand columns blank rather than
  // skipped. Dropping that branch would silently remove the people the report
  // exists to find.
  test("an employee with no beneficiaries still gets a row", async () => {
    const { cell, rowCount } = await report([employee()], []);

    assert.equal(rowCount, 1);
    assert.equal(cell(FIRST_DATA_ROW, "employeeName"), "Ana Reyes");
    assert.equal(cell(FIRST_DATA_ROW, "beneficiary"), null);
  });

  test("assembles the full name and skips the parts that are absent", async () => {
    const { cell } = await report(
      [employee({ middle_name: "Santos", suffix: "Jr." })],
      [beneficiary()],
    );

    assert.equal(cell(FIRST_DATA_ROW, "employeeName"), "Ana Santos Reyes Jr.");
  });

  // usp_sel_hr_employees joins insurance_enrollment with ie.status = 'A' in the
  // join, so a soft-deleted enrollment arrives as NULL — the same as somebody
  // who never enrolled. Two values reach the label, and "Active" was the
  // database's word for the first rather than the business's.
  test("says Enrolled or Not enrolled, never the database's letter", async () => {
    const { cell } = await report(
      [employee(), employee({ client_id: 2, enrollment_id: null, status: null })],
      [beneficiary()],
    );

    assert.equal(cell(FIRST_DATA_ROW, "status"), "Enrolled");
    assert.equal(cell(FIRST_DATA_ROW + 1, "status"), "Not enrolled");
  });

  test("an empty report says so rather than opening on a header and nothing", async () => {
    const { cell, rowCount } = await report([], []);

    assert.equal(rowCount, 0);
    assert.equal(cell(FIRST_DATA_ROW, "company"), "No enrollments to report.");
  });

  test("an empty filtered report names the period as the reason", async () => {
    const { cell } = await report([], [], { from: "2026-01-01", to: "2026-01-31" });

    assert.equal(cell(FIRST_DATA_ROW, "company"), "No enrollments in this period.");
  });

  test("the header row carries the column names", async () => {
    const { cell } = await report([employee()], [beneficiary()]);

    assert.equal(cell(HEADER_ROW, "company"), "Company");
    assert.equal(cell(HEADER_ROW, "coverage"), "Coverage");
  });
});

describe("exportService — the date range", () => {
  test("refuses a from that is not a date", async () => {
    await assert.rejects(
      () => report([employee()], [], { from: "last-tuesday" }),
      (error) => error.statusCode === 400 && /from must be a date/.test(error.message),
    );
  });

  test("refuses a to that is not a date", async () => {
    await assert.rejects(
      () => report([employee()], [], { to: "31/01/2026" }),
      (error) => error.statusCode === 400 && /to must be a date/.test(error.message),
    );
  });

  test("refuses a from later than its to", async () => {
    await assert.rejects(
      () => report([employee()], [], { from: "2026-03-01", to: "2026-02-01" }),
      (error) => error.statusCode === 400 && /cannot be later than/.test(error.message),
    );
  });

  // `to` covers the whole of its day. An enrollment at 14:30 on the closing
  // date belongs in a report that says it ends that date, and a caller passing
  // a bare date would otherwise silently lose the last day — the worst kind of
  // wrong, because the file looks complete.
  test("to includes the whole of its last day, not midnight", async () => {
    const { rowCount } = await report(
      [employee({ enrollment_date: "2026-03-15T14:30:00" })],
      [beneficiary()],
      { from: "2026-03-01", to: "2026-03-15" },
    );

    assert.equal(rowCount, 1);
  });

  test("drops an enrollment after the closing date", async () => {
    const { rowCount, employeeCount } = await report(
      [employee({ enrollment_date: "2026-03-16T09:00:00" })],
      [beneficiary()],
      { from: "2026-03-01", to: "2026-03-15" },
    );

    assert.equal(employeeCount, 0);
    assert.equal(rowCount, 0);
  });

  // An employee with no enrollment has no enrollment_date, so they cannot
  // satisfy a range and are dropped when one is given. That is the right answer
  // to "who enrolled in the last three months" — and it does mean a filtered
  // report stops being the "who has nominated nobody" list. The unfiltered one
  // still is, which is the half worth pinning.
  test("an unenrolled employee survives no range and is dropped by one", async () => {
    const unenrolled = employee({ enrollment_id: null, enrollment_date: null });

    const unfiltered = await report([unenrolled], []);
    assert.equal(unfiltered.employeeCount, 1);

    const filtered = await report([unenrolled], [], { from: "2026-01-01" });
    assert.equal(filtered.employeeCount, 0);
  });
});

describe("exportService — what it asks the database", () => {
  // The caller's role never reaches this service. usp_sel_hr_employees resolves
  // it internally and branches on Administrator itself, so the user id is the
  // whole of the scoping and it has to arrive.
  test("passes the user id to the procedure that carries the company scoping", async () => {
    const { calls } = await report([employee()], [beneficiary()]);

    assert.equal(inputsFor(calls, "usp_sel_hr_employees").us01_user_id, 7);
  });

  // usp_sel_hr_employees pages when it is given page parameters. The export
  // passes none, which is what makes @page_size = NULL return every row — the
  // compatibility promise the DBA request was built around.
  test("asks for every row rather than a page", async () => {
    const { calls } = await report([employee()], [beneficiary()]);
    const inputs = inputsFor(calls, "usp_sel_hr_employees");

    assert.equal(inputs.page, undefined);
    assert.equal(inputs.page_size, undefined);
  });

  test("sends the enrollment ids as one delimited string, deduplicated", async () => {
    const { calls } = await report(
      [
        employee({ client_id: 1, enrollment_id: 11 }),
        employee({ client_id: 2, enrollment_id: 12 }),
      ],
      [beneficiary()],
    );

    assert.equal(
      inputsFor(calls, "usp_sel_beneficiaries_by_enrollments").enrollment_ids,
      "11,12",
    );
  });

  // Nobody enrolled means no ids, and asking a procedure for the beneficiaries
  // of nothing is a round trip that can only return nothing.
  test("does not ask for beneficiaries when nobody has an enrollment", async () => {
    const { calls } = await report(
      [employee({ enrollment_id: null, enrollment_date: null })],
      [],
    );

    assert.ok(
      !calls.some((call) => call.procedure === "usp_sel_beneficiaries_by_enrollments"),
      "asked for the beneficiaries of an empty id list",
    );
  });
});
