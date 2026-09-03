import { AppError } from "../utils/AppError.js";
import { validateCoverage } from "../utils/validateCoverage.js";
import { validateHeight } from "../utils/validateHeight.js";
import {
  ADDRESS_FIELD_LENGTHS,
  BENEFICIARY_FIELD_LENGTHS,
  CLIENT_FIELD_LENGTHS,
  validateFieldLengths,
} from "../utils/validateFieldLengths.js";

export const validateEnrollmentUpdate = (req, res, next) => {
  const { client_address_id, beneficiaries } = req.body;

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
      if (!beneficiaries[i].age)
        return next(new AppError("Beneficiary age is required", 400));
      if (!beneficiaries[i].relationship)
        return next(new AppError("Beneficiary relationship is required", 400));

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

  // After the required-field loop, so a missing height reports itself as
  // missing rather than as out of range.
  const heightError = validateHeight(req.body.height);
  if (heightError) return next(new AppError(heightError, 400));

  next();
};
