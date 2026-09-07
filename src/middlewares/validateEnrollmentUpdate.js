import { AppError } from "../utils/AppError.js";
import { validateCoverage } from "../utils/validateCoverage.js";
import { validateHeight } from "../utils/validateHeight.js";
import { validateWeight } from "../utils/validateWeight.js";
import { validateBirthdate } from "../utils/validateBirthdate.js";
import { validateBeneficiaryAge } from "../utils/validateBeneficiaryAge.js";
import { normaliseGender, validateGender } from "../utils/validateGender.js";
import {
  normaliseCivilStatus,
  validateCivilStatus,
} from "../utils/validateCivilStatus.js";
import { validateZipCode } from "../utils/validateZipCode.js";
import { normaliseTinId, validateTinId } from "../utils/validateTinId.js";
import {
  normaliseContactNo,
  validateContactNo,
} from "../utils/validateContactNo.js";
import {
  normaliseSssGsisNo,
  validateSssGsisNo,
} from "../utils/validateSssGsisNo.js";
import {
  ADDRESS_FIELD_LENGTHS,
  BENEFICIARY_FIELD_LENGTHS,
  CLIENT_FIELD_LENGTHS,
  validateFieldLengths,
} from "../utils/validateFieldLengths.js";

export const validateEnrollmentUpdate = (req, res, next) => {
  const { client_address_id, beneficiaries } = req.body;

  // Before the length check below, not after. gender is capped at 1 to match
  // char(1), so "Female" would be refused for length before it could become
  // "F". Fold to the stored value first, then measure it. Validated at the
  // bottom, alongside height and weight, so a missing field still reports
  // itself as missing rather than as outside a set.
  req.body.gender = normaliseGender(req.body.gender);
  req.body.civil_status = normaliseCivilStatus(req.body.civil_status);
  req.body.tin_id = normaliseTinId(req.body.tin_id);
  req.body.contact_no = normaliseContactNo(req.body.contact_no);
  req.body.sss_gsis_no = normaliseSssGsisNo(req.body.sss_gsis_no);

  const requiredFields = [
    "first_name",
    "last_name",
    "birthdate",
    "nationality",
    "civil_status",
    "gender",
    "source_of_income",
    "tin_id",
    "sss_gsis_no",
    "email_address",
    "contact_no",
    "birthplace",
    "occupation",
    "height",
    "weight",
  ];

  const presentFields = ["middle_name", "suffix", "signature_path"];
  for (let field of presentFields) {
    if (req.body[field] === undefined) {
      return next(
        new AppError(
          `${field} must be included in the update, even if empty`,
          400,
        ),
      );
    }
  }

  const clientLengthError = validateFieldLengths(
    req.body,
    CLIENT_FIELD_LENGTHS,
  );
  if (clientLengthError) return next(new AppError(clientLengthError, 400));

  if (client_address_id) {
    requiredFields.push("barangay_id", "address_line", "zip_code");

    const addressLengthError = validateFieldLengths(
      req.body,
      ADDRESS_FIELD_LENGTHS,
    );
    if (addressLengthError) return next(new AppError(addressLengthError, 400));
  }

  if (beneficiaries !== undefined) {
    const coverageError = validateCoverage(beneficiaries);
    if (coverageError) return next(new AppError(coverageError, 400));

    for (let i = 0; i < beneficiaries.length; i++) {
      if (!beneficiaries[i].full_name)
        return next(new AppError("Beneficiary full_name is required", 400));
      if (!beneficiaries[i].relationship)
        return next(new AppError("Beneficiary relationship is required", 400));

      // Same fix as the submit path: `!age` was false for 0, so a newborn
      // could not be added or kept through a change request either.
      const ageError = validateBeneficiaryAge(beneficiaries[i].age);
      if (ageError)
        return next(new AppError(`Beneficiary ${i + 1}: ${ageError}`, 400));

      const lengthError = validateFieldLengths(
        beneficiaries[i],
        BENEFICIARY_FIELD_LENGTHS,
      );
      if (lengthError)
        return next(new AppError(`Beneficiary ${i + 1}: ${lengthError}`, 400));
    }
  }

  for (let field of requiredFields) {
    if (!req.body[field]) return next(new AppError(`${field} is required`, 400));
  }

  // After the required-field loop, so a missing height or weight reports itself
  // as missing rather than as out of range.
  const heightError = validateHeight(req.body.height);
  if (heightError) return next(new AppError(heightError, 400));

  const weightError = validateWeight(req.body.weight);
  if (weightError) return next(new AppError(weightError, 400));

  const birthdateError = validateBirthdate(req.body.birthdate);
  if (birthdateError) return next(new AppError(birthdateError, 400));

  const genderError = validateGender(req.body.gender);
  if (genderError) return next(new AppError(genderError, 400));

  const civilStatusError = validateCivilStatus(req.body.civil_status);
  if (civilStatusError) return next(new AppError(civilStatusError, 400));

  const tinIdError = validateTinId(req.body.tin_id);
  if (tinIdError) return next(new AppError(tinIdError, 400));

  const contactNoError = validateContactNo(req.body.contact_no);
  if (contactNoError) return next(new AppError(contactNoError, 400));

  const sssGsisNoError = validateSssGsisNo(req.body.sss_gsis_no);
  if (sssGsisNoError) return next(new AppError(sssGsisNoError, 400));

  // Only when an address is being changed. zip_code is not in the base
  // required list on this path — it joins it above, alongside barangay_id and
  // address_line, when client_address_id is present.
  if (client_address_id) {
    const zipCodeError = validateZipCode(req.body.zip_code);
    if (zipCodeError) return next(new AppError(zipCodeError, 400));
  }

  next();
};
