// What a password a person chooses must contain. There is one place a person
// chooses one: the forced change behind both logins, in passwordService.js.
// Temporary passwords are generated, never checked against this, and replaced
// on first sign-in.
//
// Agreed 2026-10-06, ahead of a pentest. The rule was 8 characters with a
// letter and a digit, which accepts "password1".
//
// Letters are \p{Lu} and \p{Ll}, in any script, so Ñ counts as a capital and ñ
// as a small letter, the same as the name rule in validateTextFields.js.
//
// A special character is anything that is not a letter, a combining mark, a
// digit or whitespace. Combining marks are left out for the reason names allow
// them: an ñ can arrive as n followed by a separate tilde, and that tilde is
// part of a letter, not a symbol. A space is allowed in a password but does not
// count as the special character.
//
// Length is counted by code point, so an emoji is one character, not the two
// that String.length reports.

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 64;

// bcrypt reads the first 72 bytes and silently ignores the rest, so two
// passwords that differ only after byte 72 hash the same. Sixty-four plain
// characters fit easily, but ñ is two bytes and an emoji is four, so the
// character limit alone does not keep a password inside what bcrypt reads.
export const MAX_PASSWORD_BYTES = 72;

export const PASSWORD_RULE =
  `Password must be ${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_LENGTH} characters ` +
  "and include an uppercase letter, a lowercase letter, a number and a special character";

export const PASSWORD_TOO_LONG =
  "Password is too long. Use a shorter one, or fewer accented letters and emoji";

const REQUIRED = [
  /\p{Lu}/u,
  /\p{Ll}/u,
  /\p{Nd}/u,
  /[^\p{L}\p{M}\p{N}\s]/u,
];

// Returns the problem as a message, or null. One message for every way the
// rule can fail, so the frontend has one string to show beside the field.
export const validatePassword = (password) => {
  if (typeof password !== "string") return PASSWORD_RULE;

  const length = [...password].length;

  if (length < MIN_PASSWORD_LENGTH || length > MAX_PASSWORD_LENGTH)
    return PASSWORD_RULE;

  if (!REQUIRED.every((pattern) => pattern.test(password)))
    return PASSWORD_RULE;

  if (Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES)
    return PASSWORD_TOO_LONG;

  return null;
};

export default {
  validatePassword,
  PASSWORD_RULE,
  PASSWORD_TOO_LONG,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  MAX_PASSWORD_BYTES,
};
