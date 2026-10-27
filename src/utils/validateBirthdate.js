// The employee's birthdate had no check of any kind. It was required to be
// present and went straight to sql.Date, so an unparseable value became a SQL
// conversion error and a generic 500, and a date in the future or a mistyped
// year was simply stored.
//
// The bounds follow the same reasoning as validateHeight: they are not here to
// judge whether an age is plausible, they are here to catch a value that is
// wrong. 18 is the employment floor for this system; 100 catches a mistyped
// year without ever refusing a real employee.
export const MIN_EMPLOYEE_AGE = 18;
export const MAX_EMPLOYEE_AGE = 100;

// Deliberately strict about the shape rather than handing the string to
// `new Date()` and hoping. `new Date('2026-02-30')` does not fail — it rolls
// over to 2 March and returns a valid Date, so a typo becomes a real date
// nobody notices. Matching the format first and then confirming the parts
// survived the round trip is what catches that.
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const validateBirthdate = (birthdate) => {
  if (typeof birthdate !== "string" || !ISO_DATE.test(birthdate))
    return "Birthdate must be a date in YYYY-MM-DD format";

  const [, yearText, monthText, dayText] = ISO_DATE.exec(birthdate);
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  // Built in UTC and read back in UTC so no timezone can shift the day.
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  )
    return "Birthdate is not a real date";

  // Compared as calendar parts rather than timestamps, for the same reason.
  const today = new Date();
  const todayYear = today.getFullYear();
  const todayMonth = today.getMonth() + 1;
  const todayDay = today.getDate();

  const isFuture =
    year > todayYear ||
    (year === todayYear && month > todayMonth) ||
    (year === todayYear && month === todayMonth && day > todayDay);

  if (isFuture) return "Birthdate cannot be in the future";

  let age = todayYear - year;
  // Their birthday has not come round yet this year.
  if (todayMonth < month || (todayMonth === month && todayDay < day)) age -= 1;

  if (age < MIN_EMPLOYEE_AGE || age > MAX_EMPLOYEE_AGE)
    return `Birthdate must belong to someone between ${MIN_EMPLOYEE_AGE} and ${MAX_EMPLOYEE_AGE} years old`;

  return null;
};
