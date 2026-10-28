import { trimStrings } from "./trimStrings.js";

// A company's affiliates, as the Administrator enters them. Branch 5 of the
// onboarding effort, on DBA request 25. The procedures check the code and the
// reference again, and refuse what only the database can see: a code or a
// name taken in the company, a code equal to the company's own, a reference
// used anywhere else, and a reference changed after it numbered an employee.
//
// Widths are the bes.employer_affiliates columns, read 2026-10-15: code 20,
// name 200, reference 20.

// Letters, digits and hyphens, as a company code. HR writes it in the
// invitation file (branch 6), ALAKOR for example.
const AFFILIATE_CODE = /^[A-Za-z0-9-]+$/;

// The prefix of the affiliate's own policy numbers, G-TLI-26-177-1 for
// example. No spaces, as with a company's policy number.
const REFERENCE_NO = /^\S+$/;

const text = (field, value, { max, required, pattern, describe }) => {
  if (value === undefined || value === null || value === "")
    return required ? `${field} is required` : null;

  if (typeof value !== "string") return `${field} must be text`;
  if (value.length > max) return `${field} must not exceed ${max} characters`;
  if (pattern && !pattern.test(value)) return `${field} may only contain ${describe}`;

  return null;
};

// Each field's own rule, and the fields an affiliate has. The update procedure
// takes exactly these.
const RULES = {
  affiliate_code: (value) =>
    text("affiliate_code", value, {
      max: 20,
      required: true,
      pattern: AFFILIATE_CODE,
      describe: "letters, digits and hyphens",
    }),
  affiliate_name: (value) => text("affiliate_name", value, { max: 200, required: true }),
  reference_no: (value) =>
    text("reference_no", value, {
      max: 20,
      required: false,
      pattern: REFERENCE_NO,
      describe: "letters, digits and symbols, with no spaces",
    }),
  // A real boolean, as on the company form: the string "false" is truthy.
  is_active: (value) =>
    typeof value === "boolean" ? null : "is_active must be true or false",
};

export const AFFILIATE_FIELDS = Object.keys(RULES);

// A new affiliate is active; is_active is only for the PATCH.
export const NEW_AFFILIATE_FIELDS = AFFILIATE_FIELDS.filter((field) => field !== "is_active");

// Trims, turns an empty reference into null, and refuses a field the form does
// not have, so a misspelt key is not dropped with the change it carried.
// Changes the body in place; returns the first problem, or null.
export const normaliseAffiliate = (body, { isNew }) => {
  if (!body || typeof body !== "object" || Array.isArray(body))
    return "The request body must be an object";

  const fields = isNew ? NEW_AFFILIATE_FIELDS : AFFILIATE_FIELDS;
  const unknown = Object.keys(body).find((key) => !fields.includes(key));
  if (unknown)
    return isNew
      ? `${unknown} is not a field of a new affiliate`
      : `${unknown} is not an affiliate field`;

  trimStrings(body);

  if (body.reference_no === "") body.reference_no = null;

  return null;
};

// The first problem among the fields named, or null.
export const affiliateProblem = (body, fields) => {
  for (const field of fields) {
    const problem = RULES[field](body[field]);
    if (problem) return problem;
  }
  return null;
};

export default { AFFILIATE_FIELDS, NEW_AFFILIATE_FIELDS, normaliseAffiliate, affiliateProblem };
