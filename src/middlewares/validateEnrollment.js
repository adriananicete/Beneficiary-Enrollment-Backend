import { validateCoverage } from "../utils/validateCoverage.js";

export const validateEnrollment = (req, res, next) => {
  const {
    beneficiaries
  } = req.body;

  const requiredFields = [
    "employer_id",
    "employee_id_number",
    "classification_id" ,
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

  const coverageError = validateCoverage(beneficiaries);
  if(coverageError) return res.status(400).json({error: coverageError});

  for (let i of beneficiaries) {
    if (!i.full_name)
      return res
        .status(400)
        .json({ error: "Beneficiary name is required" });
    if (!i.age)
      return res.status(400).json({ error: "Beneficiary age is required" });
    if (!i.relationship)
      return res
        .status(400)
        .json({ error: "Beneficiary relationship is required" });
  }

  

  
  next();
};
