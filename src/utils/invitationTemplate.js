import ExcelJS from "exceljs";
import { MAX_INVITATION_EMAILS } from "./partitionInvitations.js";

// HR's invitation file, branch 6 of the onboarding effort. One sheet to fill,
// one sheet of the codes it may use. Built from the company's active classes
// and active affiliates as they are now, which is why the route never lets it
// be cached: the codes change when the Administrator edits them.

export const INVITATIONS_SHEET = "Invitations";
export const CODES_SHEET = "Codes";

// The rows the dropdowns cover: as many as one upload may carry.
const LAST_ROW = MAX_INVITATION_EMAILS + 1;

// A dropdown drawn from a column of the Codes sheet. It stops a typo before
// the upload, but not a pasted value: Excel does not check pasted cells, so
// the backend matches every code again.
const dropdown = (column, count, what) => ({
  type: "list",
  allowBlank: true,
  formulae: [`${CODES_SHEET}!$${column}$2:$${column}$${count + 1}`],
  showErrorMessage: true,
  errorStyle: "error",
  errorTitle: "Not a code",
  error: `Choose ${what} from the ${CODES_SHEET} sheet.`,
});

// Text, so Excel keeps a code like "1" or an email as typed.
const TEXT = { numFmt: "@" };

// `employeeIds` adds an optional Employee ID column, for a server that keeps what is written in
// it (src/gcli/invitedEmployeeId.js): the employee then finds it filled in on their form.
export const buildInvitationTemplate = ({ company, classes, affiliates, employeeIds = false }) => {
  const workbook = new ExcelJS.Workbook();
  const hasAffiliates = affiliates.length > 0;

  // The sheet to fill. An Affiliate column only for a company that has
  // affiliates; for one without, the backend takes every row as the company.
  const sheet = workbook.addWorksheet(INVITATIONS_SHEET, {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  sheet.columns = [
    { header: "Email", key: "email", width: 40, style: TEXT },
    { header: "Classification", key: "classification", width: 20, style: TEXT },
    ...(hasAffiliates
      ? [{ header: "Affiliate", key: "affiliate", width: 20, style: TEXT }]
      : []),
    // Last, so the columns the dropdowns below are drawn on keep their places. Text, so an ID
    // like 00123 keeps its zeros.
    ...(employeeIds
      ? [{ header: "Employee ID", key: "employee_id", width: 20, style: TEXT }]
      : []),
  ];
  sheet.getRow(1).font = { bold: true };

  // The codes. Classes in A and B; the company itself, then its affiliates, in
  // D and E, so the company's own code is the first choice in the dropdown.
  const codes = workbook.addWorksheet(CODES_SHEET);

  codes.getColumn(1).width = 20;
  codes.getColumn(2).width = 40;
  codes.getCell("A1").value = "Classification";
  codes.getCell("B1").value = "Description";
  classes.forEach((c, i) => {
    codes.getCell(i + 2, 1).value = c.classification_code;
    codes.getCell(i + 2, 2).value = c.classification_desc;
  });

  if (hasAffiliates) {
    codes.getColumn(4).width = 20;
    codes.getColumn(5).width = 50;
    codes.getCell("D1").value = "Affiliate";
    codes.getCell("E1").value = "Name";
    [
      { affiliate_code: company.company_code, affiliate_name: company.company_name },
      ...affiliates,
    ].forEach((a, i) => {
      codes.getCell(i + 2, 4).value = a.affiliate_code;
      codes.getCell(i + 2, 5).value = a.affiliate_name;
    });
  }

  codes.getRow(1).font = { bold: true };

  // A company with no active class gets no dropdown: an empty list is not a
  // range Excel accepts, and every row would be refused at upload anyway.
  for (let row = 2; row <= LAST_ROW; row++) {
    if (classes.length > 0)
      sheet.getCell(row, 2).dataValidation = dropdown("A", classes.length, "a classification");

    if (hasAffiliates)
      sheet.getCell(row, 3).dataValidation = dropdown("D", affiliates.length + 1, "an affiliate");
  }

  return workbook;
};

// invitations-ABCC.xlsx. A company code is letters, digits and hyphens since
// branch 2; anything else is replaced, so the header cannot be broken.
export const invitationTemplateFileName = (company) =>
  `invitations-${String(company.company_code).replace(/[^A-Za-z0-9-]/g, "_")}.xlsx`;

export default { buildInvitationTemplate, invitationTemplateFileName, INVITATIONS_SHEET, CODES_SHEET };
