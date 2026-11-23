import { AppError } from "./AppError.js";
import { isoDateOf } from "./isoDate.js";
import { localIsoDate } from "./localDate.js";

// What HR sends to end an employee's employment, DBA request 39 (decided with
// Adrian, 2026-11-23): one of four reasons and the last day. There is no
// "Other", and the date cannot be in the future (no scheduled job).
//
// Checked here so each mistake gets its own sentence. usp_upd_employment_end
// checks the reason (50238) and the date (50244) again, and only it knows the
// enrollment date, which the date may not be before.

export const EMPLOYMENT_END_REASONS = ["RESIGNED", "TERMINATED", "CONTRACT_ENDED", "RETIRED"];

// The words a person reads, for the export.
export const EMPLOYMENT_END_LABELS = {
  RESIGNED: "Resigned",
  TERMINATED: "Terminated",
  CONTRACT_ENDED: "Contract ended",
  RETIRED: "Retired",
};

// One row of usp_sel_hr_employees. Since request 39 it also returns the
// enrollment closed when the employment ended, so "has an enrollment_id" no
// longer means "is enrolled". The dashboard and the export ask this instead.
export const isActivelyEnrolled = (row) => row?.enrollment_id != null && row?.employment_end_reason == null;

const FIELDS = ["reason", "end_date"];

// `today` is the Philippine date, which timezone.js makes this process's own.
// It is a parameter so a test can fix it. Returns { reason, endDate } or
// throws a 400.
export const parseEmploymentEnd = (body, { today = localIsoDate(new Date()) } = {}) => {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new AppError("reason and end_date are required", 400);

  const unknown = Object.keys(body).find((key) => !FIELDS.includes(key));
  if (unknown) throw new AppError(`${unknown} is not a field of an employment end`, 400);

  const { reason } = body;
  if (!EMPLOYMENT_END_REASONS.includes(reason))
    throw new AppError(`reason must be one of ${EMPLOYMENT_END_REASONS.join(", ")}`, 400);

  if (body.end_date === undefined || body.end_date === "") throw new AppError("end_date is required", 400);

  const endDate = isoDateOf(body.end_date, "end_date");
  if (endDate > today) throw new AppError("The end date cannot be in the future", 400);

  return { reason, endDate };
};

export default { EMPLOYMENT_END_REASONS, EMPLOYMENT_END_LABELS, isActivelyEnrolled, parseEmploymentEnd };
