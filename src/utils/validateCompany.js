import { trimStrings } from "./trimStrings.js";

// The Administrator's company form, branch 2 of the onboarding effort. The
// procedures (DBA request 24) check the code and the policy number again, and
// refuse a duplicate, which only the database can see. Everything else is
// checked here, so a bad value is a sentence rather than a SQL error.
//
// Widths are the dbo.employers columns, read 2026-10-12.

// Letters, digits and hyphens. The code becomes part of the HR account's
// username in branch 4 (hr.<code>), where a space or a symbol has no place.
// Coforge and HCL both fit.
const COMPANY_CODE = /^[A-Za-z0-9-]+$/;

// The prefix of every employee's policy number, G-TLI-26-177 for example. No
// spaces, as the design has it; a space inside a policy number is a typo.
const POLICY_NO = /^\S+$/;

const text = (field, value, { max, required, pattern, describe }) => {
  if (value === undefined || value === null || value === "")
    return required ? `${field} is required` : null;

  if (typeof value !== "string") return `${field} must be text`;
  if (value.length > max) return `${field} must not exceed ${max} characters`;
  if (pattern && !pattern.test(value)) return `${field} may only contain ${describe}`;

  return null;
};

// Each field's own rule, and the list of fields a company has. The procedures
// take exactly these.
const RULES = {
  company_code: (value) =>
    text("company_code", value, {
      max: 20,
      required: true,
      pattern: COMPANY_CODE,
      describe: "letters, digits and hyphens",
    }),
  company_name: (value) => text("company_name", value, { max: 200, required: true }),
  work_address: (value) => text("work_address", value, { max: 255, required: true }),
  office_no: (value) => text("office_no", value, { max: 30, required: false }),
  policy_no: (value) =>
    text("policy_no", value, {
      max: 12,
      required: true,
      pattern: POLICY_NO,
      describe: "letters, digits and symbols, with no spaces",
    }),
  // A real boolean and nothing else, as on the settings route: the string
  // "false" is truthy.
  send_coc_email: (value) =>
    typeof value === "boolean" ? null : "send_coc_email must be true or false",
  // Empty means no limit beyond the existing 18–100. A whole number, as a JSON
  // number: "65" is refused rather than guessed at. The column has a CHECK of
  // 18–100 (DBA request 23), whose error is unmapped, so it is checked here.
  online_enrollment_max_age: (value) =>
    value === null ||
    (Number.isInteger(value) && value >= 18 && value <= 100)
      ? null
      : "online_enrollment_max_age must be empty or a whole number from 18 to 100",
};

export const COMPANY_FIELDS = Object.keys(RULES);

// The two optional fields, where an empty string means "none".
const OPTIONAL = ["office_no", "online_enrollment_max_age"];

// Trims, turns an empty optional field into null, and refuses a field the form
// does not have. A misspelt key would otherwise be dropped without a word, and
// the change it carried with it. Changes the body in place; returns the first
// problem, or null.
export const normaliseCompany = (body) => {
  if (!body || typeof body !== "object" || Array.isArray(body))
    return "The request body must be an object";

  const unknown = Object.keys(body).find((key) => !COMPANY_FIELDS.includes(key));
  if (unknown) return `${unknown} is not a company field`;

  trimStrings(body);

  for (const field of OPTIONAL)
    if (body[field] === "") body[field] = null;

  return null;
};

// The first problem among the fields named, or null.
export const companyProblem = (body, fields) => {
  for (const field of fields) {
    const problem = RULES[field](body[field]);
    if (problem) return problem;
  }
  return null;
};

export default { COMPANY_FIELDS, normaliseCompany, companyProblem };
