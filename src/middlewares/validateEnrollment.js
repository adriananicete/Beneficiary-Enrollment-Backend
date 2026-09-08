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
import { isInvitationToken } from "./validateIdParam.js";
import { readSignature } from "../utils/validateSignature.js";
import {
  ADDRESS_FIELD_LENGTHS,
  BENEFICIARY_FIELD_LENGTHS,
  CLIENT_FIELD_LENGTHS,
  validateFieldLengths,
} from "../utils/validateFieldLengths.js";

export const validateEnrollment = (req, res, next) => {
  const { beneficiaries } = req.body;

  // Normalised first, validated further down. The order is load-bearing:
  // CLIENT_FIELD_LENGTHS caps gender at 1 because the column is char(1), so a
  // form sending "Female" is six characters and would be refused for length
  // before it ever became "F". Fold to the stored value, then measure it.
  req.body.gender = normaliseGender(req.body.gender);
  req.body.civil_status = normaliseCivilStatus(req.body.civil_status);
  req.body.tin_id = normaliseTinId(req.body.tin_id);
  req.body.contact_no = normaliseContactNo(req.body.contact_no);
  req.body.sss_gsis_no = normaliseSssGsisNo(req.body.sss_gsis_no);

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
    // office_no was here and is not stored anywhere. It has no binding in any
    // model, no parameter in usp_ins_client, and no column — grepped across
    // src on 2026-09-07 and it appeared only on this line. The backend was
    // refusing an enrollment for a missing field and then discarding it.
    //
    // Removed rather than wired up, because nothing has ever asked for it to
    // be stored. If it turns out the business wants an office number, that is
    // a column, a procedure parameter and a binding — not a line here.
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

  const zipCodeError = validateZipCode(req.body.zip_code);
  if (zipCodeError) return next(new AppError(zipCodeError, 400));

  // Checking the shape here means every malformed token gets the same answer as
  // a token that does not exist, which is the honest one. The rule itself is in
  // validateIdParam.js, shared with the public lookup endpoint.
  if (!isInvitationToken(req.body.token))
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
    if (!beneficiaries[i].relationship)
      return next(new AppError("Beneficiary relationship is required", 400));

    // Not `if (!age)`, which was false for 0 and refused a newborn child with
    // "Beneficiary age is required". validateBeneficiaryAge carries the
    // presence check as well as the range.
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

  // The signature, if one was sent. Optional here on purpose — the branch that
  // makes it required in production is its own, merged when the frontend
  // confirms it is sending one.
  //
  // Note what is NOT happening: `signature` is not in CLIENT_FIELD_LENGTHS and
  // never will be. Putting an image in a map of string caps is exactly what
  // truncated every signature submitted between 2026-08-10 and 2026-08-13 to
  // 500 characters.
  if (req.body.signature !== undefined && req.body.signature !== "") {
    const signatureError = attachSignature(req);
    if (signatureError) return next(new AppError(signatureError, 400));
  }

  next();
};

// Strips the data URL prefix if there is one and decodes. The prefix is
// accepted and then ignored — `readSignature` resolves the type from the
// decoded bytes, so what the caller declared is never consulted.
const DATA_URL = /^data:[^;,]*(;base64)?,/i;

const SOURCES = ["drawn", "uploaded"];

const attachSignature = (req) => {
  const { signature, signature_source } = req.body;

  if (typeof signature !== "string")
    return "signature must be a base64 image";

  // Required whenever a signature is present, rather than defaulted. This is
  // the only record of whether the employee drew it or photographed a signed
  // page, and guessing a value for an audit field is worse than refusing.
  if (!SOURCES.includes(signature_source))
    return `signature_source must be one of: ${SOURCES.join(", ")}`;

  const encoded = signature.replace(DATA_URL, "");

  // Buffer.from is famously forgiving — it drops characters it does not
  // recognise rather than failing — so a mangled string decodes to a short
  // buffer instead of an error. readSignature catches that: the bytes will not
  // begin with a PNG or JPEG header.
  const content = Buffer.from(encoded, "base64");

  const { error, mimeType, byteSize, sha256 } = readSignature(content);
  if (error) return error;

  req.signature = { content, mimeType, byteSize, sha256, source: signature_source };

  return null;
};
