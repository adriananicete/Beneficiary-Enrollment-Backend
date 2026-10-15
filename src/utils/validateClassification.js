import { trimStrings } from "./trimStrings.js";

// A company's classes and their amounts, as the Administrator enters them.
// Branch 3 of the onboarding effort, on DBA request 24. The procedures check
// the code and the benefit values again, and refuse a duplicate code, which
// only the database can see.
//
// Widths are the columns: classification_code 20, classification_desc 200,
// coverage_formula 100.

// The four benefits, and only these (decided 2026-10-14). GTLIP is required.
// GTIR is printed as a formula, as the contract writes it; the other three are
// amounts.
export const BENEFIT_CODES = ["GTLIP", "GTPDR", "ALCR", "GTIR"];
export const FORMULA_BENEFITS = ["GTIR"];

const CLASS_FIELDS = ["classification_code", "classification_desc", "is_active", "benefits"];

const text = (field, value, max) => {
  if (value === undefined || value === null || value === "") return `${field} is required`;
  if (typeof value !== "string") return `${field} must be text`;
  if (value.length > max) return `${field} must not exceed ${max} characters`;
  return null;
};

// Whole pesos above zero. A JSON number, not "120000". Safe integers only, so
// the amount that arrives is the amount that is stored.
const amountProblem = (code, value) =>
  Number.isSafeInteger(value) && value > 0
    ? null
    : `${code} must be a whole number of pesos above zero`;

const formulaProblem = (code, value) =>
  typeof value === "string" && value.length > 0 && value.length <= 100
    ? null
    : `${code} must be a formula of 1 to 100 characters, such as "50% OF GTLIP"`;

// The benefits object. On a PATCH a benefit may be null, which removes it from
// the class; GTLIP never can be. Formulas are trimmed in place.
const benefitsProblem = (benefits, { partial }) => {
  if (!benefits || typeof benefits !== "object" || Array.isArray(benefits))
    return "benefits must be an object";

  for (const [code, value] of Object.entries(benefits)) {
    if (!BENEFIT_CODES.includes(code))
      return `${code} is not a benefit. The benefits are GTLIP, GTPDR, ALCR and GTIR`;

    if (value === null) {
      if (!partial) return `${code} cannot be empty. Leave out a benefit the class does not have`;
      if (code === "GTLIP") return "GTLIP cannot be removed";
      continue;
    }

    if (FORMULA_BENEFITS.includes(code)) {
      if (typeof value === "string") benefits[code] = value.trim();
      const problem = formulaProblem(code, benefits[code]);
      if (problem) return problem;
    } else {
      const problem = amountProblem(code, value);
      if (problem) return problem;
    }
  }

  if (!partial && benefits.GTLIP === undefined) return "GTLIP is required";

  return null;
};

// POST: a whole class. Trims, refuses a field the form does not have, and
// returns the first problem, or null. is_active is not sent: a new class is
// active.
export const newClassificationProblem = (body) => {
  if (!body || typeof body !== "object" || Array.isArray(body))
    return "The request body must be an object";

  const unknown = Object.keys(body).find(
    (key) => !CLASS_FIELDS.includes(key) || key === "is_active",
  );
  if (unknown) return `${unknown} is not a field of a new classification`;

  trimStrings(body);

  return (
    text("classification_code", body.classification_code, 20) ??
    text("classification_desc", body.classification_desc, 200) ??
    benefitsProblem(body.benefits, { partial: false })
  );
};

// PATCH: any part of a class. Only what was sent is checked.
export const classificationChangesProblem = (body) => {
  if (!body || typeof body !== "object" || Array.isArray(body))
    return "The request body must be an object";

  const unknown = Object.keys(body).find((key) => !CLASS_FIELDS.includes(key));
  if (unknown) return `${unknown} is not a classification field`;

  trimStrings(body);

  // An empty benefits object changes nothing either.
  const sent = Object.keys(body);
  const emptyBenefits =
    body.benefits !== null &&
    typeof body.benefits === "object" &&
    !Array.isArray(body.benefits) &&
    Object.keys(body.benefits).length === 0;
  if (sent.length === 0 || (sent.length === 1 && emptyBenefits))
    return "Nothing to change";

  if ("classification_code" in body) {
    const problem = text("classification_code", body.classification_code, 20);
    if (problem) return problem;
  }

  if ("classification_desc" in body) {
    const problem = text("classification_desc", body.classification_desc, 200);
    if (problem) return problem;
  }

  if ("is_active" in body && typeof body.is_active !== "boolean")
    return "is_active must be true or false";

  if ("benefits" in body) return benefitsProblem(body.benefits, { partial: true });

  return null;
};

export default {
  BENEFIT_CODES,
  FORMULA_BENEFITS,
  newClassificationProblem,
  classificationChangesProblem,
};
