import { AppError } from "../utils/AppError.js";
import { validateCoverage } from "../utils/validateCoverage.js";
import { validateHeight } from "../utils/validateHeight.js";
import { validateWeight } from "../utils/validateWeight.js";
import {
  ADDRESS_FIELD_LENGTHS,
  BENEFICIARY_FIELD_LENGTHS,
  CLIENT_FIELD_LENGTHS,
  validateFieldLengths,
} from "../utils/validateFieldLengths.js";

export const validateEnrollment = (req, res, next) => {
  const { beneficiaries } = req.body;

  const requiredFields = [
    "employee_id_number",
    "classification_id",
    "first_name",
    "last_name",
    "address_line",
    "position_title",
    "nationality",
    "tin_id",
    "barangay_id",
    "zip_code",
    "birthplace",
    "birthdate",
    "civil_status",
    "gender",
    "height",
    "weight",
    "sss_gsis_no",
    "contact_no",
    "office_no",
    "occupation",
    "source_of_income",
    "consent_privacy",
    "consent_terms",
    "token"
  ];

  for (let i of requiredFields) {
    if (!req.body[i]) return next(new AppError(`${i} is required`, 400));
  }

  const heightError = validateHeight(req.body.height);
  if (heightError) return next(new AppError(heightError, 400));

  const weightError = validateWeight(req.body.weight);
  if (weightError) return next(new AppError(weightError, 400));

  // The token is 64 hex characters — crypto.randomBytes(32).toString("hex") —
  // and the column binding is NVarChar(64). Anything longer is rejected by the
  // driver before the procedure runs, which surfaces as a generic 500 on a
  // public endpoint rather than saying the invitation is not valid.
  //
  // Checking the shape here means every malformed token gets the same answer as
  // a token that does not exist, which is the honest one.
  if (!/^[a-f0-9]{64}$/i.test(req.body.token))
    return next(new AppError("Invitation not found", 404));

  const clientLengthError = validateFieldLengths(
    req.body,
    CLIENT_FIELD_LENGTHS,
  );
  if (clientLengthError) return next(new AppError(clientLengthError, 400));

  const addressLengthError = validateFieldLengths(
    req.body,
    ADDRESS_FIELD_LENGTHS,
  );
  if (addressLengthError) return next(new AppError(addressLengthError, 400));

  const coverageError = validateCoverage(beneficiaries);
  if (coverageError) return next(new AppError(coverageError, 400));

  for (let i = 0; i < beneficiaries.length; i++) {
    if (!beneficiaries[i].full_name)
      return next(new AppError("Beneficiary name is required", 400));
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

  next();
};
