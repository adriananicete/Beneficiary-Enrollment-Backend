// The rules of a Group Credit Life loan, counted the way the frontend counts them
// (src/utils/loanRules.js there), so the form and the server agree on what
// passes. docs/backend-handoff.md 2.12 B: age at entry is the age at the last
// birthday on the release date; the maturity date is the release date plus the
// term, cut to the month's last day; age at maturity is the age at the last
// birthday on that date; every limit is inclusive.
//
// Dates are YYYY-MM-DD text and are counted on their parts, never as moments,
// so no time zone can move one.

import { peso } from "./format.js";

export const LIMIT_FIELDS = [
  "min_loan",
  "max_loan",
  "max_term_months",
  "min_entry_age",
  "max_entry_age",
  "max_maturity_age",
  "no_medical_limit",
];

// Every limit but the no-medical one must be set; that one may be null (no limit).
const REQUIRED_LIMITS = LIMIT_FIELDS.filter((field) => field !== "no_medical_limit");

// A limit, a loan amount and a term are whole numbers of up to 9 digits, which fits
// every integer the database holds. Past 50 years the maturity date is not a date.
export const MAX_DIGITS = 9;
export const MAX_TERM_MONTHS = 600;

// A JSON integer, or text of digits only (the form may send either). null when it
// is neither, so "1.5", "1e3", "-2" and "ten" are all refused alike.
export const wholeNumber = (value) => {
  const typed = typeof value === "number" ? String(value) : value;
  if (typeof typed !== "string" || !new RegExp(`^\\d{1,${MAX_DIGITS}}$`).test(typed)) return null;
  return Number(typed);
};

// The first problem with a company's limits as a sentence, or null when they can be
// stored. Only the fields sent are looked at beyond the required six.
export const limitsProblem = (limits) => {
  if (!limits || typeof limits !== "object" || Array.isArray(limits))
    return "loan_limits must be an object";

  const unknown = Object.keys(limits).find((key) => !LIMIT_FIELDS.includes(key));
  if (unknown) return `${unknown} is not a loan limit`;

  const n = {};
  for (const field of LIMIT_FIELDS) {
    const value = limits[field];
    if (value === undefined || value === null) {
      if (REQUIRED_LIMITS.includes(field)) return `${field} is required`;
      n[field] = null;
      continue;
    }

    n[field] = wholeNumber(value);
    if (n[field] === null || n[field] < 1)
      return `${field} must be a whole number from 1 to 999,999,999`;
  }

  if (n.max_term_months > MAX_TERM_MONTHS)
    return `max_term_months must be at most ${MAX_TERM_MONTHS}`;
  if (n.max_loan < n.min_loan) return "max_loan cannot be below min_loan";
  if (n.min_entry_age < 18) return "min_entry_age must be at least 18";
  if (n.max_entry_age > 100) return "max_entry_age must be at most 100";
  if (n.max_entry_age < n.min_entry_age) return "max_entry_age cannot be below min_entry_age";
  if (n.max_maturity_age < n.max_entry_age) return "max_maturity_age cannot be below max_entry_age";
  if (n.max_maturity_age > 120) return "max_maturity_age must be at most 120";
  if (n.no_medical_limit !== null && n.no_medical_limit > n.max_loan)
    return "no_medical_limit cannot be above max_loan";

  return null;
};

// The limits as they are stored: whole numbers, and null for no no-medical limit.
export const limitsOf = (limits) =>
  Object.fromEntries(
    LIMIT_FIELDS.map((field) => [field, limits[field] == null ? null : wholeNumber(limits[field])]),
  );

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const daysInMonth = (year, month) =>
  month === 2
    ? (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
      ? 29
      : 28
    : [4, 6, 9, 11].includes(month)
      ? 30
      : 31;

// { year, month, day } for a real date, else null.
export const parseDay = (value) => {
  const match = typeof value === "string" ? ISO_DATE.exec(value) : null;
  if (!match) return null;

  const [year, month, day] = match.slice(1).map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;

  return { year, month, day };
};

const pad = (value, width = 2) => String(value).padStart(width, "0");

// Age at the last birthday, on a day. null when either is not a real date.
export const ageOn = (birthdate, onDate) => {
  const born = parseDay(birthdate);
  const day = parseDay(onDate);
  if (!born || !day) return null;

  const passed = day.month > born.month || (day.month === born.month && day.day >= born.day);
  return day.year - born.year - (passed ? 0 : 1);
};

// The same day number `months` on, or the last day of that month when it has none
// (31 January plus a month is 28 or 29 February). null for a date that is not one.
export const addMonths = (releaseDate, months) => {
  const start = parseDay(releaseDate);
  if (!start) return null;

  const index = start.year * 12 + (start.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;

  return `${pad(year, 4)}-${pad(month)}-${pad(Math.min(start.day, daysInMonth(year, month)))}`;
};

// The loan against the company's limits. `loan` is what was sent
// ({ loan_amount, term_months, release_date }); `birthdate` the borrower's.
// Answers the reasons as sentences (empty when it passes), the dates worked out,
// and whether the amount is above the no-medical limit (flagged, never refused).
export const checkLoan = (limits, loan, birthdate, companyName = "The company") => {
  const reasons = [];
  const amount = wholeNumber(loan?.loan_amount);
  const term = wholeNumber(loan?.term_months);
  const release = parseDay(loan?.release_date);

  if (amount === null || amount < 1)
    reasons.push("Enter the loan amount in whole pesos, with numbers only (up to 9 digits).");
  else if (amount > limits.max_loan)
    reasons.push(`${companyName} covers loans up to ${peso(limits.max_loan)}.`);
  else if (amount < limits.min_loan)
    reasons.push(`${companyName} covers loans of ${peso(limits.min_loan)} or more.`);

  if (term === null || term < 1) reasons.push("Enter the term in whole months, at least 1 (up to 9 digits).");
  else if (term > limits.max_term_months)
    reasons.push(`${companyName} covers terms up to ${limits.max_term_months} months.`);

  if (!release) reasons.push("Enter the loan release date as a real date (YYYY-MM-DD).");

  const maturity = release && term !== null && term >= 1 ? addMonths(loan.release_date, term) : null;
  const entryAge = release ? ageOn(birthdate, loan.release_date) : null;
  const maturityAge = maturity ? ageOn(birthdate, maturity) : null;

  if (entryAge !== null && (entryAge < limits.min_entry_age || entryAge > limits.max_entry_age))
    reasons.push(
      `${companyName} covers borrowers aged ${limits.min_entry_age} to ${limits.max_entry_age} years old on the release date; you would be ${entryAge}.`,
    );
  else if (maturityAge !== null && maturityAge > limits.max_maturity_age)
    reasons.push(
      `This loan would end when you are ${maturityAge}. ${companyName} covers loans that end by age ${limits.max_maturity_age}.`,
    );

  return {
    reasons,
    maturityDate: maturity,
    ageAtEntry: entryAge,
    ageAtMaturity: maturityAge,
    aboveNoMedicalLimit: amount !== null && limits.no_medical_limit != null && amount > limits.no_medical_limit,
  };
};

export default { limitsProblem, limitsOf, checkLoan, ageOn, addMonths, parseDay, wholeNumber };
