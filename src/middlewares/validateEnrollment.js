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
    "coverage_amount",
    "consent_privacy",
    "consent_terms",
  ];

  for (let i of requiredFields) {
    if (!req.body[i])
      return res.status(400).json({ error: `${i} is required` });
  }

  if (
    !beneficiaries ||
    !Array.isArray(beneficiaries) ||
    beneficiaries.length === 0
  )
    return res
      .status(400)
      .json({ error: "At least one beneficiary is required" });

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
    if (!i.coverage_percent) {
      return res
        .status(400)
        .json({ error: "Beneficiary coverage percent is required" });
    }
  }

  const totalSumOfCoveragePercent = beneficiaries.reduce(
    (acc, cur) => acc + cur.coverage_percent,
    0,
  );

  if(totalSumOfCoveragePercent !== 100) return res.status(400).json({error: 'Coverage Percent should be 100%'});
  
  next();
};
