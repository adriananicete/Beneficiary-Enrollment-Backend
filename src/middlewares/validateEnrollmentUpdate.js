export const validateEnrollmentUpdate = (req, res, next) => {
  const requiredFields = [
    "first_name",
    "last_name",
    "birthdate",
    "nationality",
    "civil_status",
    "gender",
    "source_of_income",
  ];

  if (req.body.client_address_id) {
    requiredFields.push("barangay_id", "address_line", "zip_code");
  }

  if (
    Array.isArray(req.body.beneficiaries) &&
    req.body.beneficiaries.length > 0
  ) {
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
      if (beneficiary.coverage_percent === undefined)
        return res
          .status(400)
          .json({ error: "Beneficiary coverage_percent is required" });
    }
  }

  for (let field of requiredFields) {
    if (!req.body[field])
      return res.status(400).json({ error: `${field} is required` });
  }

  next();
};
