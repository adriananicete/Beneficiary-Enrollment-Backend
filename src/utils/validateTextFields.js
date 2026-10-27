// What a name, a nationality or a relationship may be made of, where
// validateFieldLengths only says how long it may be. Until 2026-09-23 length
// was the only check, so "Juan123", "@@@" and a name of nothing but spaces all
// reached the database. The live data held four such rows, all of them test
// records.
//
// This is data quality, not security. Every query here is parameterised, and
// every email template escapes what it prints.
//
// Letters are \p{L}, any script, so ñ, é and ü are letters as they should be
// and nobody's name is refused for being Filipino or Spanish. \p{M} is the
// combining marks, for an é that arrives as e followed by an accent — which is
// what some phones and some copy-pastes produce.
//
// Both kinds must START with a letter, so ".Juan" and "-Santos" are refused.

// Names: letters, spaces, and the three marks real names carry — the hyphen in
// Dela Cruz-Santos, the apostrophe in D'Souza, the period in Ma. and Jr. The
// curly apostrophe is here because phones substitute it for the straight one.
// A suffix is a name for this purpose: Jr., Sr., III. "3rd" is refused, as the
// digits in it are what this exists to refuse.
const NAME = /^\p{L}[\p{L}\p{M} .'’-]*$/u;

// Words: letters, spaces and hyphens. Hyphens because "Mother-in-law" is a
// relationship and it would be refused without one.
const WORDS = /^\p{L}[\p{L}\p{M} -]*$/u;

const KINDS = {
  name: {
    pattern: NAME,
    describe: "letters, spaces, hyphens, apostrophes and periods",
  },
  words: {
    pattern: WORDS,
    describe: "letters, spaces and hyphens",
  },
};

export const CLIENT_TEXT_RULES = {
  first_name: "name",
  middle_name: "name",
  last_name: "name",
  suffix: "name",
  nationality: "words",
};

export const BENEFICIARY_TEXT_RULES = {
  full_name: "name",
  relationship: "words",
};

// Birthplace, occupation and source of income are deliberately not here. Each
// can legitimately hold a digit — "Brgy. 2", "Level 3 Engineer" — so they are
// checked for length and for being blank, and nothing else.

// Returns the first problem as a message naming the field, or null.
//
// An absent or empty value is not this function's business: whether a field
// may be empty is the required-field check's call, and middle_name and suffix
// may be. Anything present has to be text — a number or an array would
// otherwise pass the required check for being truthy and be stored as its
// string form.
export const validateTextFields = (record, rules) => {
  for (const [field, kind] of Object.entries(rules)) {
    const value = record[field];

    if (value === undefined || value === null || value === "") continue;

    if (typeof value !== "string") return `${field} must be text`;

    const { pattern, describe } = KINDS[kind];

    if (!pattern.test(value))
      return `${field} may only contain ${describe}`;
  }

  return null;
};

export default { validateTextFields, CLIENT_TEXT_RULES, BENEFICIARY_TEXT_RULES };
