import { localIsoDate } from "../utils/localDate.js";
import { normaliseContactNo, validateContactNo } from "../utils/validateContactNo.js";
import { EMAIL_PATTERN } from "../utils/validateEmailAddress.js";
import { LOSS_CODES } from "./policy.js";
import { GENERAL } from "./profiles.js";

// The rules for the details of a claim (docs/claims-details/CONTRACT.md, "The details object"),
// written as one table per claim profile and read by one small engine. The frontend has the same
// rules in its own src/claims/profiles.js; both are tested against docs/claims-details/cases.json,
// so a rule changed on one side shows up as a failing case on the other.
//
// Strict on purpose: a key that is not in the table is refused at every level, so nothing reaches
// the store that a person did not see on the form. Text is trimmed, and an empty string means "not
// given". The answer is { value, errors }: `errors` maps the dotted path of a field to a plain
// sentence meant to be shown beside it, and `value` is the cleaned details when there are none.

export const MAX_DETAILS_CHARS = 12000;

const RELATIONSHIPS = ["SELF", "SPOUSE", "CHILD", "PARENT", "SIBLING", "OTHER_BENEFICIARY", "OTHER"];
const YES_NO = ["YES", "NO"];

const text = (label, max, options = {}) => ({ kind: "text", label, max, ...options });
const choice = (label, values, options = {}) => ({ kind: "choice", label, values, ...options });
const date = (label, options = {}) => ({ kind: "date", label, ...options });

// 150 is the width the DBA proposed for the column (CLAIM-DETAILS-DBA-REQUEST.md); the contract
// gives no limit of its own.
const contactNo = { kind: "contact_no", label: "the claimant's contact number", required: true };
const email = { kind: "email", label: "the claimant's email address", max: 150 };

const claimant = (relationship = {}) => ({
  name: text("the claimant's name", 150, { required: true, min: 2 }),
  relationship: choice("the claimant's relationship to the insured", RELATIONSHIPS, { required: true, ...relationship }),
  contact_no: contactNo,
  email_address: email,
});

// The event is the death, the onset, the diagnosis or the accident, and the form names it as such.
const event = (dateLabel, placeLabel, placeRequired = false) => ({
  date: date(dateLabel, { required: true, afterBirth: true }),
  place: text(placeLabel, 200, { required: placeRequired }),
});

// ARDCI's "Agent & Location": where the claim comes from, and the agent who serves the insured when
// the filer knows who that is. The same for every claim type.
const agentLocation = {
  agent: text("the agent", 150),
  city_municipality: text("the city or municipality", 100, { required: true }),
  province: text("the province", 100, { required: true }),
  region: text("the region", 100),
};

const SPECS = {
  death: {
    claimant: claimant({ refuse: { SELF: "The insured cannot be the claimant of a death claim. Choose the claimant's relationship to the insured." } }),
    event: event("the date of death", "the place of death"),
    agent_location: agentLocation,
    condition: {
      immediate_cause: text("the immediate cause of death", 200, { required: true }),
      antecedent_cause: text("the antecedent cause", 200),
      underlying_cause: text("the underlying cause", 200),
      other_conditions: text("the other conditions", 1000),
      manner_of_death: choice("the manner of death", ["NATURAL", "ACCIDENT", "SUICIDE", "HOMICIDE", "UNDETERMINED"], { required: true }),
      covid_related: choice("the COVID-19 indicator", YES_NO),
    },
  },
  tpd: {
    claimant: claimant(),
    event: event("the date the disability began", "the place"),
    agent_location: agentLocation,
    condition: {
      disabling_condition: text("the disabling condition", 300, { required: true }),
      cause: choice("the cause", ["ACCIDENT", "SICKNESS"], { required: true }),
      diagnosis: text("the diagnosis", 300),
      attending_physician: text("the attending physician", 150),
      hospital_or_clinic: text("the hospital or clinic", 200),
      unable_to_work_since: date("the date the employee became unable to work", {
        notBefore: (whole) => whole.event?.date,
        notBeforeLabel: "the date the disability began",
      }),
    },
  },
  terminal_illness: {
    claimant: claimant(),
    event: event("the date of diagnosis", "the place"),
    agent_location: agentLocation,
    condition: {
      diagnosis: text("the diagnosis", 300, { required: true }),
      attending_physician: text("the attending physician", 150, { required: true }),
      hospital_or_clinic: text("the hospital or clinic", 200),
      prognosis: text("the prognosis", 300),
    },
  },
  dismemberment: {
    claimant: claimant(),
    event: event("the date of the accident", "the place of the accident", true),
    agent_location: agentLocation,
    condition: {
      type_of_loss: choice(
        "the type of loss",
        LOSS_CODES,
        { required: true },
      ),
      loss_description: text("the description of the loss", 200, {
        required: (section) => section.type_of_loss === "OTHER",
      }),
      accident_description: text("the description of the accident", 1000, { required: true }),
      police_report_filed: choice("whether a police report was filed", YES_NO, { required: true }),
    },
  },
};

const SECTIONS = ["claimant", "event", "condition", "agent_location"];

const UNKNOWN_KEY = "This field is not part of the form.";

const sentence = (label) => label[0].toUpperCase() + label.slice(1);

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// Built and read back in UTC, so no time zone can move the day. 2026-02-30 is not a date.
export const isRealDate = (value) => {
  const match = ISO_DATE.exec(value);
  if (!match) return false;

  const [year, month, day] = match.slice(1).map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
};

// Each reader gets the trimmed, non-empty text and answers { value } or { error }.
const READERS = {
  text: (given, field) => {
    if (field.min && given.length < field.min)
      return { error: `${sentence(field.label)} must be at least ${field.min} characters.` };

    if (given.length > field.max)
      return { error: `${sentence(field.label)} must be ${field.max} characters or fewer.` };

    return { value: given };
  },

  choice: (given, field) => {
    if (!field.values.includes(given)) return { error: `Choose ${field.label} from the list.` };

    if (field.refuse?.[given]) return { error: field.refuse[given] };

    return { value: given };
  },

  date: (given, field, context, whole) => {
    if (!isRealDate(given)) return { error: `${sentence(field.label)} must be a real date, as YYYY-MM-DD.` };

    if (given > context.today) return { error: `${sentence(field.label)} cannot be in the future.` };

    if (field.afterBirth && context.birthdate && given < context.birthdate)
      return { error: `${sentence(field.label)} cannot be before the employee's date of birth.` };

    const earliest = field.notBefore?.(whole);
    if (earliest && given < earliest)
      return { error: `${sentence(field.label)} cannot be before ${field.notBeforeLabel}.` };

    return { value: given };
  },

  // BES's own rule for a mobile number, and the same folding of +63 and separators.
  contact_no: (given) => {
    const number = normaliseContactNo(given);
    const problem = validateContactNo(number);

    return problem ? { error: `${problem}.` } : { value: number };
  },

  email: (given, field) => {
    if (given.length > field.max || !EMAIL_PATTERN.test(given))
      return { error: "Enter a valid email address, as name@example.com." };

    return { value: given };
  },
};

const isRequired = (field, section) =>
  typeof field.required === "function" ? field.required(section) : Boolean(field.required);

// One field: { value } when it is given and good, {} when it is not given and not needed, and
// { error } otherwise. `section` is what has been read of this section so far, `whole` of the
// sections before it, for the two rules that depend on another field.
const readField = (raw, field, section, whole, context) => {
  if (raw !== undefined && raw !== null && typeof raw !== "string")
    return { error: `${sentence(field.label)} must be text.` };

  const given = typeof raw === "string" ? raw.trim() : "";

  if (given === "") {
    if (!isRequired(field, section)) return {};

    return { error: `${field.kind === "choice" ? "Choose" : "Enter"} ${field.label}.` };
  }

  return READERS[field.kind](given, field, context, whole);
};

const readSection = (name, spec, input, whole, context, errors) => {
  const section = {};

  // Left out entirely is the same as empty: each required field is named, rather than one error
  // for the section.
  const given = input === undefined ? {} : input;

  if (!isPlainObject(given)) {
    errors[name] = `${sentence(name)} must be an object.`;
    return section;
  }

  for (const key of Object.keys(given))
    if (!Object.hasOwn(spec, key)) errors[`${name}.${key}`] = UNKNOWN_KEY;

  for (const [key, field] of Object.entries(spec)) {
    const { value, error } = readField(given[key], field, section, whole, context);

    if (error) errors[`${name}.${key}`] = error;
    else if (value !== undefined) section[key] = value;
  }

  return section;
};

// `input` is the details as an object, or undefined or null when none were sent. `birthdate` is
// the employee's, "YYYY-MM-DD", and `today` the Philippine date; both are parameters so a test
// can fix them.
export const validateDetails = (profile, input, { today = localIsoDate(new Date()), birthdate } = {}) => {
  // No prototype: errors[key] for a top-level key such as "__proto__" would otherwise set the
  // prototype and leave the unknown key unreported.
  const errors = Object.create(null);

  if (profile === GENERAL) {
    if (input !== undefined && input !== null) errors.details = "This claim type takes no details.";

    return { value: null, errors };
  }

  const spec = SPECS[profile];
  if (!spec) throw new Error(`No details schema for the profile "${profile}"`);

  if (input === undefined || input === null) {
    errors.details = "Enter the claim details.";
    return { value: null, errors };
  }

  if (!isPlainObject(input)) {
    errors.details = "The details must be an object.";
    return { value: null, errors };
  }

  for (const key of Object.keys(input)) if (!SECTIONS.includes(key)) errors[key] = UNKNOWN_KEY;

  const whole = {};
  for (const name of SECTIONS)
    whole[name] = readSection(name, spec[name], input[name], whole, { today, birthdate }, errors);

  return { value: Object.keys(errors).length === 0 ? whole : null, errors };
};

// The `details` field as it arrives: JSON text from a multipart form, or an object from a JSON
// request. Nothing sent is "not given". The length is checked on the text, before it is parsed.
export const parseDetails = (raw) => {
  if (raw === undefined || raw === null) return { input: undefined };

  const body = typeof raw === "string" ? raw : JSON.stringify(raw);

  if (body.trim() === "") return { input: undefined };

  if (body.length > MAX_DETAILS_CHARS)
    return { errors: { details: `The details must be ${MAX_DETAILS_CHARS} characters or fewer.` } };

  try {
    return { input: JSON.parse(body) };
  } catch {
    return { errors: { details: "The details are not valid JSON." } };
  }
};

// Both steps, for the code that files a claim.
export const checkDetails = (profile, raw, context) => {
  const { input, errors } = parseDetails(raw);

  return errors ? { value: null, errors } : validateDetails(profile, input, context);
};

export default { MAX_DETAILS_CHARS, validateDetails, parseDetails, checkDetails };
