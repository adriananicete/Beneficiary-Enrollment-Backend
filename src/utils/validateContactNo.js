// Always 09 and eleven digits — settled 2026-09-07 after reading the 44 contact
// numbers in dbo.clients. Two shapes were in use and they are the same numbers:
// 09XXXXXXXXX and +639XXXXXXXXX, with `+639171234567` and `09171234567` both
// present as separate values.
//
// So +63 and 63 prefixes are accepted and folded to the leading zero rather
// than refused. The digits are the number; the prefix is how somebody typed it.
// Nothing depends on contact_no being unique, so this is about the column
// meaning one thing rather than about collisions.
//
// varchar(30) suggested the column might be holding two numbers or an
// extension. Reading the data says no — every row is one mobile number, and
// the widest is thirteen characters.
const MOBILE = /^09\d{9}$/;

export const normaliseContactNo = (contactNo) => {
  if (typeof contactNo !== "string") return contactNo;

  const trimmed = contactNo.trim();

  // Separators people type and nobody means: spaces, dashes, brackets, dots.
  const cleaned = trimmed.replace(/[\s\-().]/g, "");

  // +639XXXXXXXXX and 639XXXXXXXXX both become 09XXXXXXXXX. Anchored on the 9
  // after the country code so a landline cannot be mangled into a mobile.
  const international = /^\+?63(9\d{9})$/.exec(cleaned);
  if (international) return `0${international[1]}`;

  if (/^\d+$/.test(cleaned)) return cleaned;

  return trimmed;
};

export const validateContactNo = (contactNo) => {
  if (typeof contactNo !== "string" || !MOBILE.test(contactNo))
    return "Contact number must be 11 digits starting with 09, as 09171234567";

  return null;
};
