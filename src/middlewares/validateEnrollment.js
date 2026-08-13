import { validateCoverage } from "../utils/validateCoverage.js";
import {
  ADDRESS_FIELD_LENGTHS,
  BENEFICIARY_FIELD_LENGTHS,
  CLIENT_FIELD_LENGTHS,
  validateFieldLengths,
} from "../utils/validateFieldLengths.js";

export const validateEnrollment = (req, res, next) => {
  const { beneficiaries } = req.body;

  const requiredFields = [
    "employer_id",
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
    "email_address",
    "occupation",
    "source_of_income",
    "consent_privacy",
    "consent_terms",
  ];

  for (let i of requiredFields) {
    if (!req.body[i])
      return res.status(400).json({ error: `${i} is required` });
  }

  const clientLengthError = validateFieldLengths(
    req.body,
    CLIENT_FIELD_LENGTHS,
  );
  if (clientLengthError)
    return res.status(400).json({ error: clientLengthError });

  const addressLengthError = validateFieldLengths(
    req.body,
    ADDRESS_FIELD_LENGTHS,
  );
  if (addressLengthError)
    return res.status(400).json({ error: addressLengthError });

  const coverageError = validateCoverage(beneficiaries);
  if (coverageError) return res.status(400).json({ error: coverageError });

  for (let i = 0; i < beneficiaries.length; i++) {
    if (!beneficiaries[i].full_name)
      return res.status(400).json({ error: "Beneficiary name is required" });
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

  next();
};
