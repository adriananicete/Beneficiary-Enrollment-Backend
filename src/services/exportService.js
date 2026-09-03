import ExcelJS from "exceljs";
import ClientModel from "../models/clientModel.js";
import BeneficiaryModel from "../models/beneficiaryModel.js";
import { poolPromise } from "../config/db.js";
import { AppError } from "../utils/AppError.js";

// Taken from the email templates so a printed report and an email from the same
// system look like they came from the same place.
const BRAND = {
  navy: "FF1A1760",
  navyMid: "FF2C3B7D",
  green: "FF409965",
  headerText: "FFFFFFFF",
  band: "FFF4F6FA",
  rule: "FFD8DDE8",
  muted: "FF6B7280",
};

const COLUMNS = [
  { header: "Company", key: "company", width: 30 },
  { header: "Employee No.", key: "employeeNo", width: 16 },
  { header: "Employee Name", key: "employeeName", width: 30 },
  { header: "Email Address", key: "email", width: 34 },
  { header: "Enrollment Status", key: "status", width: 18 },
  { header: "Beneficiary", key: "beneficiary", width: 30 },
  { header: "Relationship", key: "relationship", width: 16 },
  { header: "Age", key: "age", width: 8 },
  { header: "Coverage", key: "coverage", width: 12 },
];

const TITLE_ROW = 1;
const SUBTITLE_ROW = 2;
const HEADER_ROW = 4;
const FIRST_DATA_ROW = 5;

// A date range is expressed as from/to rather than named periods. "Last 3
// months", "this year" and "January to March" are all the same shape once the
// dates are worked out, and working them out belongs with the button that says
// which one — putting named periods here would fix an interpretation the caller
// might not share. Six months from today, or from the first of the month six
// months back? The UI knows; this does not have to.
//
// `to` covers the whole of its day. An enrollment at 14:30 on the closing date
// belongs in a report that says it ends that date, and a caller passing a bare
// date would otherwise silently lose the last day.
const parseRange = ({ from, to }) => {
  const start = from ? new Date(`${from}T00:00:00`) : null;
  const end = to ? new Date(`${to}T23:59:59.999`) : null;

  if (from && Number.isNaN(start?.getTime()))
    throw new AppError("from must be a date, as YYYY-MM-DD", 400);

  if (to && Number.isNaN(end?.getTime()))
    throw new AppError("to must be a date, as YYYY-MM-DD", 400);

  if (start && end && start > end)
    throw new AppError("from cannot be later than to", 400);

  return { start, end };
};

// Filtering happens here rather than in the procedure because
// usp_sel_hr_employees has no date parameters and the export reads every row it
// can see anyway. Nothing is gained by asking the DBA for this.
//
// An employee with no enrollment has no enrollment_date, so they cannot satisfy
// a date range and are dropped when one is given. That is the right answer to
// "who enrolled in the last three months" — but it does mean a filtered report
// stops being the "who has nominated nobody" list. The unfiltered one still is.
const withinRange = (employees, { start, end }) => {
  if (!start && !end) return employees;

  return employees.filter((employee) => {
    if (!employee.enrollment_date) return false;

    const enrolled = new Date(employee.enrollment_date);

    if (start && enrolled < start) return false;
    if (end && enrolled > end) return false;

    return true;
  });
};

const fullName = ({ first_name, middle_name, last_name, suffix }) =>
  [first_name, middle_name, last_name, suffix]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(" ");

// The column answers one question: has this person enrolled?
//
// usp_sel_hr_employees joins insurance_enrollment with ie.status = 'A' already
// in the join, so a soft-deleted enrollment never comes back as 'D' — it arrives
// as NULL, the same as somebody who never enrolled. Two values reach here, and
// "Active" was the database's word for the first rather than the business's.
const statusLabel = (status) => (status === "A" ? "Enrolled" : "Not enrolled");

// One row per beneficiary, employee columns repeated down the group. An employee
// with none still produces a row, blank on the right — that is the "who has
// nominated nobody" report, and it comes free.
//
// Deliberately not merged cells for the repeated values. Merging looks tidier and
// breaks sorting, filtering and pivoting, which is the entire reason for a flat
// export. The banding below carries the grouping instead.
const buildRows = (employees, beneficiaries) => {
  const byEnrollment = new Map();

  for (const beneficiary of beneficiaries) {
    const key = String(beneficiary.enrollment_id);
    if (!byEnrollment.has(key)) byEnrollment.set(key, []);
    byEnrollment.get(key).push(beneficiary);
  }

  const rows = [];

  for (const [index, employee] of employees.entries()) {
    const employeeCells = {
      company: employee.company_name,
      employeeNo: employee.employee_id_number,
      employeeName: fullName(employee),
      email: employee.email_address,
      status: statusLabel(employee.status),
    };

    const owned = employee.enrollment_id
      ? (byEnrollment.get(String(employee.enrollment_id)) ?? [])
      : [];

    // employeeIndex rather than the row number: the band has to change per
    // person, not per line, or a three-beneficiary employee is striped in the
    // middle and stops reading as one block.
    if (owned.length === 0) {
      rows.push({ ...employeeCells, employeeIndex: index });
      continue;
    }

    for (const beneficiary of owned) {
      rows.push({
        ...employeeCells,
        beneficiary: beneficiary.full_name,
        relationship: beneficiary.relationship,
        age: beneficiary.age,
        coverage: beneficiary.coverage_percent,
        employeeIndex: index,
      });
    }
  }

  return rows;
};

const asDate = (value) =>
  value.toLocaleDateString("en-PH", { dateStyle: "medium" });

const rangeLabel = ({ start, end }) => {
  if (start && end) return `${asDate(start)} to ${asDate(end)}`;
  if (start) return `From ${asDate(start)}`;
  if (end) return `Up to ${asDate(end)}`;
  return "All enrollments";
};

const applyTitle = (sheet, { scope, period, employeeCount, rowCount }) => {
  const lastColumn = COLUMNS.length;

  sheet.mergeCells(TITLE_ROW, 1, TITLE_ROW, lastColumn);
  const title = sheet.getCell(TITLE_ROW, 1);
  title.value = "Beneficiary Enrollment Report";
  title.font = { name: "Segoe UI", size: 16, bold: true, color: { argb: BRAND.headerText } };
  title.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  title.fill = {
    type: "gradient",
    gradient: "angle",
    degree: 0,
    stops: [
      { position: 0, color: { argb: BRAND.navyMid } },
      { position: 1, color: { argb: BRAND.green } },
    ],
  };
  sheet.getRow(TITLE_ROW).height = 34;

  sheet.mergeCells(SUBTITLE_ROW, 1, SUBTITLE_ROW, lastColumn);
  const subtitle = sheet.getCell(SUBTITLE_ROW, 1);
  // The period is stated on the sheet on purpose. A filtered export that does
  // not say so is indistinguishable from a complete one the moment it is
  // forwarded, printed, or opened next quarter.
  subtitle.value =
    `${scope}  •  ${period}  •  ${employeeCount} employees, ${rowCount} rows  •  ` +
    `Generated ${new Date().toLocaleString("en-PH", { dateStyle: "long", timeStyle: "short" })}`;
  subtitle.font = { name: "Segoe UI", size: 10, color: { argb: BRAND.muted } };
  subtitle.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  sheet.getRow(SUBTITLE_ROW).height = 20;
};

const applyHeader = (sheet) => {
  const header = sheet.getRow(HEADER_ROW);

  header.values = COLUMNS.map((column) => column.header);
  header.height = 24;

  header.eachCell((cell) => {
    cell.font = { name: "Segoe UI", size: 11, bold: true, color: { argb: BRAND.headerText } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.navy } };
    cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    cell.border = { bottom: { style: "thin", color: { argb: BRAND.navy } } };
  });

  // Both anchored to the header row so the filter dropdowns sit on the headers
  // and everything above stays put while the data scrolls.
  sheet.autoFilter = {
    from: { row: HEADER_ROW, column: 1 },
    to: { row: HEADER_ROW, column: COLUMNS.length },
  };

  sheet.views = [{ state: "frozen", ySplit: HEADER_ROW }];
};

const applyRowStyle = (row, { banded, startsEmployee }) => {
  row.height = 18;

  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { name: "Segoe UI", size: 10 };
    cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };

    if (banded) {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.band } };
    }

    // A rule above the first row of each employee, so the groups read as
    // blocks without anything being merged.
    cell.border = startsEmployee
      ? { top: { style: "thin", color: { argb: BRAND.rule } } }
      : undefined;
  });

  const coverage = row.getCell("coverage");
  coverage.numFmt = '0.00"%"';
  coverage.alignment = { vertical: "middle", horizontal: "right", indent: 1 };

  row.getCell("age").alignment = { vertical: "middle", horizontal: "center" };
};

const applyPrintSetup = (sheet) => {
  sheet.pageSetup = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: {
      left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3,
    },
  };

  // Repeat the header on every printed page — without it page two of a long
  // report is a wall of unlabelled columns.
  sheet.pageSetup.printTitlesRow = `${HEADER_ROW}:${HEADER_ROW}`;
  sheet.headerFooter = { oddFooter: "&LPhilLife Finance Corporation&RPage &P of &N" };
};

// Takes only the user id. The caller's role never reaches here on purpose —
// usp_sel_hr_employees resolves it internally and branches on Administrator
// itself, so passing it would invite someone to make a second decision from it.
export const buildEnrollmentReport = async (userId, range = {}) => {
  const { start, end } = parseRange(range);

  const pool = await poolPromise;

  // usp_sel_hr_employees carries the company scoping — is_current, both status
  // flags, us08_is_active, and the Administrator branch. It is not reproduced
  // here on purpose: an access rule in two places is a leak waiting for one of
  // them to be edited, and this endpoint emits a file rather than a screen.
  const visible = await ClientModel.getHrEmployees(pool, userId);
  const employees = withinRange(visible, { start, end });

  const enrollmentIds = employees
    .map((employee) => employee.enrollment_id)
    .filter(Boolean);

  const beneficiaries = await BeneficiaryModel.getBeneficiariesByEnrollmentIds(
    pool,
    enrollmentIds,
  );

  const rows = buildRows(employees, beneficiaries);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "PhilLife Beneficiary Enrollment System";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Enrollments", {
    views: [{ state: "frozen", ySplit: HEADER_ROW }],
  });

  sheet.columns = COLUMNS.map(({ key, width }) => ({ key, width }));

  const companies = new Set(employees.map((employee) => employee.company_name));
  const scope =
    companies.size === 1
      ? [...companies][0]
      : `All companies (${companies.size})`;

  applyTitle(sheet, {
    scope,
    period: rangeLabel({ start, end }),
    employeeCount: employees.length,
    rowCount: rows.length,
  });
  applyHeader(sheet);

  let previousEmployeeIndex = null;

  for (const row of rows) {
    const { employeeIndex, ...values } = row;
    const added = sheet.addRow(values);

    applyRowStyle(added, {
      banded: employeeIndex % 2 === 1,
      startsEmployee: employeeIndex !== previousEmployeeIndex,
    });

    previousEmployeeIndex = employeeIndex;
  }

  // An empty report is still a report. Without this the file opens on a header
  // and nothing, which reads like a failure rather than an answer.
  if (rows.length === 0) {
    const empty = sheet.addRow({
      company:
        start || end
          ? "No enrollments in this period."
          : "No enrollments to report.",
    });
    empty.getCell("company").font = {
      name: "Segoe UI", size: 10, italic: true, color: { argb: BRAND.muted },
    };
  }

  applyPrintSetup(sheet);

  return { workbook, employeeCount: employees.length, rowCount: rows.length };
};

export default { buildEnrollmentReport };
