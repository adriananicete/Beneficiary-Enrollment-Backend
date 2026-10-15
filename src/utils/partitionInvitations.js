import { EMAIL_PATTERN } from "./validateEmailAddress.js";

// Rows, since branch 6 of the onboarding effort: the name stays because the
// limit has not changed.
export const MAX_INVITATION_EMAILS = 1000;

const MAX_EMAIL_LENGTH = 150;

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
export const partitionInvitations = (rows, { company, classes, affiliates }) => {
  const classIds = new Map(classes.map((c) => [keyOf(c.classification_code), c.classification_id]));
  const affiliateIds = new Map(affiliates.map((a) => [keyOf(a.affiliate_code), a.affiliate_id]));
  const ownCode = keyOf(codeText(company.company_code));
  const hasAffiliates = affiliates.length > 0;

  const valid = [];
  const rejected = [];
  const seen = new Set();

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
    const classCode = codeText(row.classification_code);
    if (classCode === "") {
      rejected.push({ email, status: "invalid", reason: "Classification is required" });
      continue;
    }

    const classificationId = classIds.get(keyOf(classCode));
    if (classificationId === undefined) {
      rejected.push({ email, status: "invalid", reason: `Unknown classification code "${classCode}"` });
      continue;
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

    seen.add(email);
    valid.push({ email, classificationId, affiliateId });
  }

  return { valid, rejected };
};
