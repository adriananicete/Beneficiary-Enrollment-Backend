// The column is char(1) — `@gender char(1)` in usp_ins_client — so the stored
// value can only ever be a single character. Male / Female / Other are the
// three the business asked for, which makes M / F / O the storable form.
//
// The form sends whatever the user picked, so the words are accepted too and
// folded to the letter before storage. That is the whole reason normalise
// exists: without it "Male", "male" and "M" are three different values in a
// column that has room for one character, and a report grouped by gender is
// wrong in a way nobody notices until somebody counts.
export const GENDERS = ["M", "F", "O"];

const WORDS = {
  MALE: "M",
  FEMALE: "F",
  OTHER: "O",
};

// Returns the canonical single character, or the input untouched when it is
// not recognised — so validateGender is the thing that reports the problem and
// this never has to invent an error of its own.
export const normaliseGender = (gender) => {
  if (typeof gender !== "string") return gender;

  const trimmed = gender.trim().toUpperCase();

  return WORDS[trimmed] ?? trimmed;
};

export const validateGender = (gender) => {
  if (typeof gender !== "string" || !GENDERS.includes(gender))
    return `Gender must be one of: ${GENDERS.join(", ")}`;

  return null;
};
