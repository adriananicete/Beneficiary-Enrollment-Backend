import { isRealDate } from "./detailsSchema.js";

// What the claims web app reports back about a claim it took (docs/claims-details/CONTRACT.md, "The
// outcome"): ARDCI's "Amount & Status", and the reasons that go with it. The status is the claims
// department's own wording, kept and shown as it is: its list is long and its own, and BES has none to
// hold it to. Every field is optional, but one at least is sent, and a report replaces the one before:
// what is not sent is not kept. The answer is { value, errors }, like the claim details'.

const MAX_AMOUNT = 999999999.99;

// key -> [kind, longest text, how the field is named in a message]
const FIELDS = {
  status: ["text", 100, "The status"],
  status_updated: ["date", null, "The date of the status update"],
  total_claim_amount: ["amount", null, "The total amount of claim"],
  burial_benefit_amount: ["amount", null, "The total amount of burial benefit"],
  credit_claim_benefit_amount: ["amount", null, "The credit claim benefit"],
  amount_paid: ["amount", null, "The amount paid"],
  denial_letter_date: ["date", null, "The date the denial letter was issued"],
  denial_reason: ["text", 300, "The reason for denial"],
  awaiting_reason: ["text", 300, "The reason for awaiting"],
};

// What only HR sees: what the claim pays and what was paid.
export const AMOUNT_FIELDS = Object.keys(FIELDS).filter((key) => FIELDS[key][0] === "amount");

const UNKNOWN_KEY = "This field is not part of the outcome.";

const READERS = {
  text: (given, max, label) => {
    if (typeof given !== "string") return { error: `${label} must be text.` };

    const trimmed = given.trim();
    if (trimmed.length > max) return { error: `${label} must be ${max} characters or fewer.` };

    return { value: trimmed };
  },

  date: (given, max, label) =>
    typeof given === "string" && isRealDate(given.trim())
      ? { value: given.trim() }
      : { error: `${label} must be a date written YYYY-MM-DD.` },

  amount: (given, max, label) => {
    const cents = typeof given === "number" ? given * 100 : NaN;
    const valid = Number.isFinite(cents) && given >= 0 && given <= MAX_AMOUNT && Math.abs(cents - Math.round(cents)) < 1e-6;

    return valid ? { value: Math.round(cents) / 100 } : { error: `${label} must be an amount from 0 to 999,999,999.99 with at most two decimals.` };
  },
};

export const checkOutcome = (body) => {
  // No prototype, so a key such as __proto__ is an ordinary name and not a way past the check.
  const errors = Object.create(null);
  const value = {};

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    errors.outcome = "Send the outcome as a JSON object.";
    return { value: null, errors };
  }

  for (const key of Object.keys(body)) {
    if (!Object.hasOwn(FIELDS, key)) {
      errors[key] = UNKNOWN_KEY;
      continue;
    }

    const given = body[key];
    // null and an empty text mean "not given", as in the claim details.
    if (given === null || given === "") continue;

    const [kind, max, label] = FIELDS[key];
    const read = READERS[kind](given, max, label);

    if (read.error) errors[key] = read.error;
    else if (read.value !== "") value[key] = read.value;
  }

  if (Object.keys(errors).length === 0 && Object.keys(value).length === 0) errors.outcome = "Send at least one field.";

  return { value: Object.keys(errors).length === 0 ? value : null, errors };
};

// What a claim's answer carries: all of it for HR, and for the employee what the claims department said
// about the claim but not what it pays. null when nothing has been reported.
export const outcomeView = (outcome, { amounts }) => {
  if (!outcome) return null;
  if (amounts) return outcome;

  const view = { ...outcome };
  for (const key of AMOUNT_FIELDS) delete view[key];

  return view;
};

export default { AMOUNT_FIELDS, checkOutcome, outcomeView };
