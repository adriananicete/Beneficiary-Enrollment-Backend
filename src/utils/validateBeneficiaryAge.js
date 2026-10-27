// A beneficiary's age was required to be present and never checked. It binds to
// sql.Int, so a non-numeric value became a conversion error and a generic 500.
//
// Zero is valid and this is the part worth stating plainly: a newborn child is
// an ordinary beneficiary. Both middlewares used to guard this with
// `if (!beneficiaries[i].age)`, which is false for 0 — so naming a baby was
// refused with "Beneficiary age is required", a message about the wrong thing
// entirely.
export const MIN_BENEFICIARY_AGE = 0;
export const MAX_BENEFICIARY_AGE = 120;

export const validateBeneficiaryAge = (age) => {
  if (age === undefined || age === null || age === "")
    return "Beneficiary age is required";

  const value = Number(age);

  if (!Number.isInteger(value)) return "Beneficiary age must be a whole number";

  if (value < MIN_BENEFICIARY_AGE || value > MAX_BENEFICIARY_AGE)
    return `Beneficiary age must be between ${MIN_BENEFICIARY_AGE} and ${MAX_BENEFICIARY_AGE}`;

  return null;
};
