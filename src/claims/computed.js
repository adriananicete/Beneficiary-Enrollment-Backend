import { fullName } from "../utils/fullName.js";
import { localIsoDate } from "../utils/localDate.js";

// What the server works out about a claim from the employee's own enrollment, never from what the
// person typed (docs/claims-details/CONTRACT.md, "What the server works out"). Pure functions:
// dates are "YYYY-MM-DD" text and the filing date is a parameter, so a test can fix all of them.

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DAY_MS = 24 * 60 * 60 * 1000;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

// Whole days since 1970 for a "YYYY-MM-DD" text, or null. Read in UTC so no time zone and no
// daylight saving can move a day; the process runs on Philippine time and the text carries none.
const dayNumber = (value) => {
  const match = typeof value === "string" ? ISO_DATE.exec(value) : null;
  if (!match) return null;

  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS;
};

// Age at the last birthday before the event, as ARDCI counts it.
export const ageAtEvent = (birthdate, eventDate) => {
  const born = ISO_DATE.exec(birthdate ?? "");
  const event = ISO_DATE.exec(eventDate ?? "");
  if (!born || !event) return null;

  const [birthYear, birthMonth, birthDay] = born.slice(1).map(Number);
  const [eventYear, eventMonth, eventDay] = event.slice(1).map(Number);

  const birthdayPassed = eventMonth > birthMonth || (eventMonth === birthMonth && eventDay >= birthDay);

  return eventYear - birthYear - (birthdayPassed ? 0 : 1);
};

// LESS_THAN_2 | 2_TO_LESS_THAN_3 | 3_OR_MORE, from the exact length of membership. The decision is
// taken on the unrounded figure: 364 days is under a year, whatever it rounds to.
const bandOf = (years) => {
  if (years < 2) return "LESS_THAN_2";

  return years < 3 ? "2_TO_LESS_THAN_3" : "3_OR_MORE";
};

// `years_of_membership`, `membership_band` and `contestability` are null when the event is before
// the coverage began or a date is missing; the claim is still recorded and the claims web app
// decides what that means.
export const computedOf = ({ birthdate, eventDate, effectiveDate, filedOn }) => {
  const event = dayNumber(eventDate);
  const effective = dayNumber(effectiveDate);
  const filed = ISO_DATE.exec(filedOn ?? "");

  const eventBeforeCoverage = event !== null && effective !== null && event < effective;
  const measurable = event !== null && effective !== null && !eventBeforeCoverage;

  const years = measurable ? (event - effective) / 365.25 : null;

  return {
    age_at_event: ageAtEvent(birthdate, eventDate),
    years_of_membership: measurable ? Math.round(years * 10) / 10 : null,
    membership_band: measurable ? bandOf(years) : null,
    contestability: measurable ? (years < 1 ? "CONTESTABLE" : "INCONTESTABLE") : null,
    event_year: event === null ? null : Number(eventDate.slice(0, 4)),
    filed_year: filed ? Number(filed[1]) : null,
    filed_month: filed ? MONTHS[Number(filed[2]) - 1] : null,
    event_before_coverage: eventBeforeCoverage,
  };
};

// The enrollment's date as "YYYY-MM-DD": enrollment_date is a datetime, read in Philippine time.
const dayOf = (value) => {
  if (value instanceof Date) return localIsoDate(value);

  return typeof value === "string" && ISO_DATE.test(value) ? value.slice(0, 10) : null;
};

// A snapshot of the enrollment at filing, so a later edit does not rewrite what a claim was
// judged on. Named field by field: the enrollment row holds far more (the TIN, the address).
export const insuredOf = (enrollment) => ({
  client_id: String(enrollment.client_id),
  enrollment_id: String(enrollment.enrollment_id),
  full_name: fullName(enrollment),
  birthdate: enrollment.birthdate ?? null,
  gender: enrollment.gender ?? null,
  company_code: enrollment.company_code ?? null,
  company_name: enrollment.company_name ?? null,
  policy_no: enrollment.policy_no ?? null,
  classification: enrollment.classification_desc ?? null,
  effective_date: dayOf(enrollment.enrollment_date),
});

// The insured's benefits as usp_get_enrollment_benefits_by_id returns them. A rider such as the
// terminal illness one has a formula ("50% OF GTLIP") in place of an amount.
export const coverageOf = (benefits) =>
  benefits.map((benefit) => ({
    code: benefit.benefit_name,
    description: benefit.benefit_description ?? null,
    amount: benefit.coverage_amount === null || benefit.coverage_amount === undefined ? null : Number(benefit.coverage_amount),
    formula: benefit.coverage_formula ?? null,
  }));

// Everything stored beside the details. `filedOn` is the filing date, "YYYY-MM-DD".
export const factsOf = ({ details, enrollment, benefits, filedOn = localIsoDate(new Date()) }) => {
  const insured = insuredOf(enrollment);

  return {
    insured,
    computed: computedOf({
      birthdate: insured.birthdate,
      eventDate: details.event.date,
      effectiveDate: insured.effective_date,
      filedOn,
    }),
    coverage: coverageOf(benefits),
  };
};

export default { ageAtEvent, computedOf, insuredOf, coverageOf, factsOf };
