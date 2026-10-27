// Nine or twelve digits, stored with dashes — settled 2026-09-07 after reading
// the 42 TINs in dbo.clients. Both lengths were already present: 26 rows in the
// nine-digit form, 15 in the twelve-digit form, and one with no dashes at all.
//
// The stored procedure asks for nothing. usp_ins_client declares
// @tin_id varchar(20) and the duplicate check behind 50009 is
// `WHERE tin_id = @tin_id` — an exact string match. So the format was never a
// lookup, it was a decision, and the exact match is what makes normalising
// worth doing rather than optional.
//
// The live defect this closes is in the data: `543453566` and `543-453-566`
// are the same taxpayer and do not collide under an exact match, so that
// person could hold two client rows and 50009 would never fire. Dashes are
// presentation; the digits are the identity.
//
// KNOWN AND ACCEPTED: nine and twelve stay distinct. `123-456-789` and
// `123-456-789-000` remain different strings, so the same taxpayer enrolling
// once in each shape is not refused. The last three digits are a branch code
// rather than part of a person's identity, and three rows in the live data
// already share the base 123-456-789 across different branch codes. Treating
// them as one identity was considered and not chosen.
const NINE = /^\d{3}-\d{3}-\d{3}$/;
const TWELVE = /^\d{3}-\d{3}-\d{3}-\d{3}$/;

const group = (digits) => digits.match(/\d{3}/g).join("-");

// Strips dashes, regroups, and hands back anything it cannot make sense of so
// validateTinId is the only thing that reports a problem. Regrouping is
// deliberate: `123-45-6789` carries nine digits in the wrong places, and the
// digits are what identify the taxpayer.
export const normaliseTinId = (tinId) => {
  if (typeof tinId !== "string") return tinId;

  const trimmed = tinId.trim();
  const digits = trimmed.replace(/-/g, "");

  if (!/^\d+$/.test(digits)) return trimmed;
  if (digits.length !== 9 && digits.length !== 12) return trimmed;

  return group(digits);
};

export const validateTinId = (tinId) => {
  if (typeof tinId !== "string" || (!NINE.test(tinId) && !TWELVE.test(tinId)))
    return "TIN must be 9 or 12 digits, as 123-456-789 or 123-456-789-000";

  return null;
};
