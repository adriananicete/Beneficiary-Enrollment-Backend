// One definition of what an email address looks like, for the two places that
// take one from a person: HR's invitation upload and an employee's change
// request.
//
// Deliberately loose: something, an @, something, a dot, something, and no
// spaces. The only real proof of an address is mail arriving at it; this
// catches the typo and the field filled with something else entirely.
//
// Moved out of partitionEmails.js on 2026-09-23, when the change request needed
// it too. Until then an employee could change their email to "abc", and that
// value is synced to sec.us01_users — where resend-credentials and the
// Certificate of Coverage are sent.
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const validateEmailAddress = (email) => {
  if (typeof email !== "string" || !EMAIL_PATTERN.test(email))
    return "email_address must be a valid email address, as name@example.com";

  return null;
};

export default { EMAIL_PATTERN, validateEmailAddress };
