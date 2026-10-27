import { EMAIL_PATTERN } from "./validateEmailAddress.js";

// Rows, since branch 6 of the onboarding effort: the name stays because the
// limit has not changed.
export const MAX_INVITATION_EMAILS = 1000;

const MAX_EMAIL_LENGTH = 150;

// The width of the Employee ID field on the enrollment form. It becomes the
// employee's login name, whose column is wider (50), so this is the tighter limit.
export const MAX_EMPLOYEE_ID_LENGTH = 30;

// What Excel makes of a long number typed into a General cell: 1234567890123 is shown, and read
// back, as 1.23457E+12. It is never what HR meant, and it would become the employee's login.
const SHORTENED_BY_EXCEL = /^\d(\.\d+)?E[+-]\d{2}$/i;

// A code as HR wrote it, trimmed. A cell Excel read as a number (1) is taken
// as its text ("1"). Empty when the cell was.
const codeText = (value) => {
  if (value === undefined || value === null) return "";
  return String(value).trim();
};

const keyOf = (code) => code.toUpperCase();

// HR uploads a file, so a bad row is expected rather than exceptional. Splitting
// the batch lets the good rows go out while the rejected ones are reported back
// per row, instead of one typo failing the whole upload.
//
// Each row is an email, a class code and, for a company with affiliates, an
// affiliate code (branch 6). The codes are matched here, trimmed and without
// regard to case, against the company's active classes and active affiliates,
// read once before the job starts. The company's own code in the Affiliate
// column means the company itself, with or without affiliates (Adrian,
// 2026-10-15), and is kept as no affiliate.
//
// A row may also carry the employee's ID (employee_id_number), which the employee then
// finds filled in on the enrollment form. It is optional, and read only where the server
// can keep it (`employeeIds` true, src/gcli): elsewhere it is ignored, and the employee
// types their own as before. A repeat within the upload is refused, whatever its case.
export const partitionInvitations = (rows, { company, classes, affiliates, classified = true, employeeIds = false }) => {
  const classIds = new Map(classes.map((c) => [keyOf(c.classification_code), c.classification_id]));
  const affiliateIds = new Map(affiliates.map((a) => [keyOf(a.affiliate_code), a.affiliate_id]));
  const ownCode = keyOf(codeText(company.company_code));
  const hasAffiliates = affiliates.length > 0;

  const valid = [];
  const rejected = [];
  const seen = new Set();
  const seenIds = new Set();

  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      rejected.push({ email: String(row), status: "invalid", reason: "Not a row of the file" });
      continue;
    }

    const entry = row.email_address;

    if (typeof entry !== "string") {
      rejected.push({
        email: String(entry),
        status: "invalid",
        reason: "Not a text value",
      });
      continue;
    }

    const email = entry.trim().toLowerCase();

    if (!EMAIL_PATTERN.test(email)) {
      // Report what was submitted, not the normalised form — HR has to find
      // this row in their own file.
      rejected.push({
        email: entry,
        status: "invalid",
        reason: "Not a valid email address",
      });
      continue;
    }

    if (email.length > MAX_EMAIL_LENGTH) {
      rejected.push({
        email,
        status: "invalid",
        reason: `Longer than ${MAX_EMAIL_LENGTH} characters`,
      });
      continue;
    }

    if (seen.has(email)) {
      rejected.push({
        email,
        status: "duplicate",
        reason: "Repeated in this upload",
      });
      continue;
    }

    // The reasons quote the code as HR wrote it, so HR can find it in the file.
    // A borrower of a credit company is not classified (`classified` false, src/gcli),
    // so a class code in the row is not asked for and not read.
    let classificationId = null;
    if (classified) {
      const classCode = codeText(row.classification_code);
      if (classCode === "") {
        rejected.push({ email, status: "invalid", reason: "Classification is required" });
        continue;
      }

      classificationId = classIds.get(keyOf(classCode));
      if (classificationId === undefined) {
        rejected.push({ email, status: "invalid", reason: `Unknown classification code "${classCode}"` });
        continue;
      }
    }

    const affiliateCode = codeText(row.affiliate_code);
    let affiliateId = null;

    if (affiliateCode === "") {
      // A forgotten cell, caught: on a company with affiliates, the company
      // itself is written as its own code, never left blank.
      if (hasAffiliates) {
        rejected.push({ email, status: "invalid", reason: "Affiliate is required for this company" });
        continue;
      }
    } else if (keyOf(affiliateCode) !== ownCode) {
      if (!hasAffiliates) {
        rejected.push({ email, status: "invalid", reason: "This company has no affiliates" });
        continue;
      }

      affiliateId = affiliateIds.get(keyOf(affiliateCode));
      if (affiliateId === undefined) {
        rejected.push({ email, status: "invalid", reason: `Unknown affiliate code "${affiliateCode}"` });
        continue;
      }
    }

    let employeeId = null;
    if (employeeIds) {
      const cell = row.employee_id_number;

      // text or a number, as a cell of a file gives; anything else (an object, true) is not an ID
      if (cell !== undefined && cell !== null && typeof cell !== "string" && typeof cell !== "number") {
        rejected.push({ email, status: "invalid", reason: "Employee ID must be text" });
        continue;
      }

      const id = codeText(cell);

      if (SHORTENED_BY_EXCEL.test(id)) {
        rejected.push({
          email,
          status: "invalid",
          reason: `Employee ID "${id}" is a number that Excel shortened. Format the column as Text and enter it again`,
        });
        continue;
      }

      if (id.length > MAX_EMPLOYEE_ID_LENGTH) {
        rejected.push({ email, status: "invalid", reason: `Employee ID is longer than ${MAX_EMPLOYEE_ID_LENGTH} characters` });
        continue;
      }

      if (id !== "" && seenIds.has(id.toLowerCase())) {
        rejected.push({ email, status: "duplicate", reason: "Employee ID repeated in this upload" });
        continue;
      }

      if (id !== "") employeeId = id;
    }

    seen.add(email);
    if (employeeId) seenIds.add(employeeId.toLowerCase());
    valid.push({ email, classificationId, affiliateId, ...(employeeId ? { employeeId } : {}) });
  }

  return { valid, rejected };
};
