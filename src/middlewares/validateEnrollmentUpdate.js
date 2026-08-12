import { validateCoverage } from "../utils/validateCoverage.js";
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
      return res.status(400).json({
        error: `${field} must be included in the update, even if empty`,
      });
    }
  }

  const clientLengthError = validateFieldLengths(
    req.body,
    CLIENT_FIELD_LENGTHS,
  );
  if (clientLengthError)
    return res.status(400).json({ error: clientLengthError });

  if (client_address_id) {
    requiredFields.push("barangay_id", "address_line", "zip_code");

    const addressLengthError = validateFieldLengths(
      req.body,
      ADDRESS_FIELD_LENGTHS,
    );
    if (addressLengthError)
      return res.status(400).json({ error: addressLengthError });
  }

  if (beneficiaries !== undefined) {
    const coverageError = validateCoverage(beneficiaries);
    if (coverageError) return res.status(400).json({ error: coverageError });
    for (let i = 0; i < beneficiaries.length; i++) {
      if (!beneficiaries[i].full_name)
        return res
          .status(400)
          .json({ error: "Beneficiary full_name is required" });
      if (!beneficiaries[i].age)
        return res.status(400).json({ error: "Beneficiary age is required" });
      if (!beneficiaries[i].relationship)
        return res
          .status(400)
          .json({ error: "Beneficiary relationship is required" });
      const lengthError = validateFieldLengths(
        beneficiaries[i],
        BENEFICIARY_FIELD_LENGTHS,
      );
      if (lengthError)
        return res
          .status(400)
          .json({ error: `Beneficiary ${i + 1}: ${lengthError}` });
    }
  }

  for (let field of requiredFields) {
    if (!req.body[field])
      return res.status(400).json({ error: `${field} is required` });
  }

  next();
};
