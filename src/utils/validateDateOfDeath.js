import { localIsoDate } from "./localDate.js";

// The date of death HR enters when marking an employee deceased. Decided
// 2026-10-06 and 2026-10-12, md/CLAIMS-AND-MESSAGING-DECISIONS.md: required;
// not in the future; not before the birthdate; not before the enrollment date.
// The last is pending with the business and refused until they answer.
//
// Returns a message, or null, the way validateBirthdate does. It is called
// twice: once with nothing but the value, before the database is asked, and
// again with the employee's birthdate and enrollment date once they are read.
// usp_upd_client_death checks all of it again (50162), so this is the readable
// answer, not the only guard.
//
// Every date here is "YYYY-MM-DD" text, which sorts the way dates do, so they
// are compared as text. No Date object and no time zone can move a day.

// Strict about the shape, as validateBirthdate is: `new Date("2026-02-30")`
// quietly becomes 2 March.
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const isRealDate = (text) => {
  const [, yearText, monthText, dayText] = ISO_DATE.exec(text);
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  // Built and read back in UTC, so no time zone can shift the day.
  const parsed = new Date(Date.UTC(year, month - 1, day));

  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
};

// `today` is the Philippine date, which timezone.js makes this process's own.
// It is a parameter so a test can fix it.
export const validateDateOfDeath = (
  value,
  { today = localIsoDate(new Date()), birthdate, enrollmentDate } = {},
) => {
  if (typeof value !== "string" || !ISO_DATE.test(value))
    return "date_of_death must be a date in YYYY-MM-DD format";

  if (!isRealDate(value)) return "date_of_death is not a real date";

  if (value > today) return "The date of death cannot be in the future";

  if (typeof birthdate === "string" && value < birthdate)
    return "The date of death cannot be before the birthdate";

  if (typeof enrollmentDate === "string" && value < enrollmentDate)
    return "The date of death cannot be before the enrollment date";

  return null;
};

export default { validateDateOfDeath };
