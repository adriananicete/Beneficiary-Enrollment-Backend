export const validateEnrollment = (req, res, next) => {
  const {
    companyId,
    insuredName,
    nationality,
    tin,
    region,
    province,
    cityMunicipality,
    barangay,
    streetNumber,
    zipCode,
    placeOfBirth,
    dateOfBirth,
    civilStatus,
    gender,
    heightFeet,
    heightInches,
    weight,
    sssGsisNo,
    contactNo,
    officeNo,
    email,
    occupation,
    placeOfWork,
    sourceOfIncome,
    amountOfInsurance,
    consentPrivacy,
    consentTerms,
    beneficiaries,
  } = req.body;

  const requiredFields = [
    "companyId",
    "insuredName",
    "nationality",
    "tin",
    "region",
    "province",
    "cityMunicipality",
    "barangay",
    "streetNumber",
    "zipCode",
    "placeOfBirth",
    "dateOfBirth",
    "civilStatus",
    "gender",
    "heightFeet",
    "heightInches",
    "weight",
    "contactNo",
    "officeNo",
    "email",
    "sssGsisNo",
    "occupation",
    "placeOfWork",
    "sourceOfIncome",
    "amountOfInsurance",
    "consentPrivacy",
    "consentTerms",
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
    if (!i.fullName)
      return res
        .status(400)
        .json({ error: "Beneficiary fullName is required" });
    if (!i.age)
      return res.status(400).json({ error: "Beneficiary age is required" });
    if (!i.relationship)
      return res
        .status(400)
        .json({ error: "Beneficiary relationship is required" });
  }
  next();
};
