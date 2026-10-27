// The six the business settled on, 2026-09-07. The column is varchar(20) and
// the longest of these is "Legally Separated" at 17, so all six fit as written.
//
// Stored in this exact casing. Before this the field was free text capped at 20
// characters, so "Single", "single" and "SINGLE" were three different values
// and anything grouped by civil status was counting them separately.
export const CIVIL_STATUSES = [
  "Single",
  "Married",
  "Widowed",
  "Legally Separated",
  "Divorced",
  "Annulled",
];

const BY_COMPARISON = new Map(
  CIVIL_STATUSES.map((status) => [status.toUpperCase(), status]),
);

// Case and surrounding whitespace are forgiven and folded to the canonical
// form. Internal spacing is not — "Legally  Separated" with two spaces is not
// recognised, because guessing at what somebody meant is how a set stops being
// a set. Returns the input untouched when unrecognised, leaving the reporting
// to validateCivilStatus.
export const normaliseCivilStatus = (civilStatus) => {
  if (typeof civilStatus !== "string") return civilStatus;

  const trimmed = civilStatus.trim();

  return BY_COMPARISON.get(trimmed.toUpperCase()) ?? trimmed;
};

export const validateCivilStatus = (civilStatus) => {
  if (typeof civilStatus !== "string" || !CIVIL_STATUSES.includes(civilStatus))
    return `Civil status must be one of: ${CIVIL_STATUSES.join(", ")}`;

  return null;
};
