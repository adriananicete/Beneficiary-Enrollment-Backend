import { validateCoverage } from "../utils/validateCoverage.js";

export const validateEnrollmentUpdate = (req, res, next) => {
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

  const presentFields = ["middle_name", "suffix"];
  for(let field of presentFields) {
    if(req.body[field] === undefined) {
      return res.status(400).json({ error: `${field} must be included in the update, even if empty`})
    }
  }

  if (req.body.client_address_id) {
    requiredFields.push("barangay_id", "address_line", "zip_code");
  }

  if (req.body.beneficiaries !== undefined) {
    const coverageError = validateCoverage(req.body.beneficiaries);
    if (coverageError) return res.status(400).json({ error: coverageError });
    for (let beneficiary of req.body.beneficiaries) {
      if (!beneficiary.beneficiary_id)
        return res.status(400).json({ error: "beneficiary_id is required" });
      if (!beneficiary.full_name)
        return res
          .status(400)
          .json({ error: "Beneficiary full_name is required" });
      if (!beneficiary.age)
        return res.status(400).json({ error: "Beneficiary age is required" });
      if (!beneficiary.relationship)
        return res
          .status(400)
          .json({ error: "Beneficiary relationship is required" });
    }
  }

  for (let field of requiredFields) {
    if (!req.body[field])
      return res.status(400).json({ error: `${field} is required` });
  }

  next();
};
