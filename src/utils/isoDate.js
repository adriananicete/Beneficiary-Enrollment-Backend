import { AppError } from "./AppError.js";

// A calendar date given as YYYY-MM-DD in a query, or null when not given.
// 2026-02-30 is refused, not rolled over into March. Shared by the two logs'
// lists (security events, the audit trail).
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const isoDateOf = (value, name) => {
  if (value === undefined || value === "") return null;

  const valid =
    typeof value === "string" &&
    ISO_DATE.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);

  if (!valid) throw new AppError(`${name} must be a date written as YYYY-MM-DD`, 400);

  return value;
};

// Both inclusive; a from after a to is refused.
export const isoDateRangeOf = (query, fromName, toName) => {
  const fromDate = isoDateOf(query[fromName], fromName);
  const toDate = isoDateOf(query[toName], toName);

  if (fromDate !== null && toDate !== null && fromDate > toDate)
    throw new AppError(`${fromName} must not be after ${toName}`, 400);

  return { fromDate, toDate };
};

export default { isoDateOf, isoDateRangeOf };
