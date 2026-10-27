// One column holding two different schemes, which is why it takes two shapes.
// Settled 2026-09-07:
//
//   SSS  — ten digits,   stored dashed as  12-3456789-0
//   GSIS — eleven digits, stored bare  as  12345678901
//
// The lengths are what tell them apart, so nothing has to be declared. Read
// from the 78 values in dbo.clients: 26 already dashed, 11 bare ten-digit, and
// no eleven-digit yet — GSIS is being specified ahead of its first employee.
//
// The bare ten-digit rows are the reason normalising exists here. `1234567890`
// and `12-3456789-0` are the same number in a column that stores one of them,
// so the digits are grouped and the dashes are added.
const SSS = /^\d{2}-\d{7}-\d$/;
const GSIS = /^\d{11}$/;

export const normaliseSssGsisNo = (sssGsisNo) => {
  if (typeof sssGsisNo !== "string") return sssGsisNo;

  const trimmed = sssGsisNo.trim();
  const digits = trimmed.replace(/[\s-]/g, "");

  if (!/^\d+$/.test(digits)) return trimmed;

  // Ten digits are SSS and get the dashes. Eleven are GSIS and stay bare —
  // grouping them the same way would invent a format nobody uses.
  if (digits.length === 10)
    return `${digits.slice(0, 2)}-${digits.slice(2, 9)}-${digits.slice(9)}`;

  if (digits.length === 11) return digits;

  return trimmed;
};

export const validateSssGsisNo = (sssGsisNo) => {
  if (
    typeof sssGsisNo !== "string" ||
    (!SSS.test(sssGsisNo) && !GSIS.test(sssGsisNo))
  )
    return "SSS number must be 10 digits as 12-3456789-0, or a GSIS number of 11 digits as 12345678901";

  return null;
};
