export const MAX_INVITATION_EMAILS = 1000;

const MAX_EMAIL_LENGTH = 150;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// HR uploads a file, so a bad row is expected rather than exceptional. Splitting
// the batch lets the good addresses go out while the rejected ones are reported
// back per row, instead of one typo failing the whole upload.
export const partitionEmails = (emails) => {
  const valid = [];
  const rejected = [];
  const seen = new Set();

  for (const entry of emails) {
    if (typeof entry !== "string") {
      rejected.push({
        email: String(entry),
        status: "invalid",
        reason: "Not a text value",
      });
      continue;
    }

    const email = entry.trim().toLowerCase();

    if (!EMAIL_PATTERN.test(email)) {
      // Report what was submitted, not the normalised form — HR has to find
      // this row in their own file.
      rejected.push({
        email: entry,
        status: "invalid",
        reason: "Not a valid email address",
      });
      continue;
    }

    if (email.length > MAX_EMAIL_LENGTH) {
      rejected.push({
        email,
        status: "invalid",
        reason: `Longer than ${MAX_EMAIL_LENGTH} characters`,
      });
      continue;
    }

    if (seen.has(email)) {
      rejected.push({
        email,
        status: "duplicate",
        reason: "Repeated in this upload",
      });
      continue;
    }

    seen.add(email);
    valid.push(email);
  }

  return { valid, rejected };
};
