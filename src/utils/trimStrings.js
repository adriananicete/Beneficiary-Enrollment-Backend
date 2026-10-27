// Trims every string property of a record, in place, and returns it.
//
// Run first in both enrollment validators, so that everything after it sees
// what will be stored. Two things depend on that. The required-field checks
// test for a value with `!value`, and "   " is a value, so a name made of
// spaces used to pass as present. And the length caps measured the untrimmed
// string, so trailing spaces counted against them and were then stored.
//
// Only the record's own properties, one level deep. The beneficiaries are
// trimmed by the caller, one record at a time, because they are an array of
// records rather than a string.
//
// Trimming does not create a false change on a change request. The
// beneficiary diff already compares trimmed values (changeRequestDiff.js), and
// the personal fields are compared by the procedure, where SQL Server ignores
// trailing spaces in an equality test.
export const trimStrings = (record) => {
  if (!record || typeof record !== "object") return record;

  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string") record[key] = value.trim();
  }

  return record;
};

// The beneficiaries array, when there is one. Anything that is not an array is
// left for validateCoverage to refuse by name.
export const trimBeneficiaries = (beneficiaries) => {
  if (Array.isArray(beneficiaries)) beneficiaries.forEach(trimStrings);
  return beneficiaries;
};

export default { trimStrings, trimBeneficiaries };
