import { sql } from "../config/db.js";

const insertEnrollment = async (pool, enrollmentData) => {
  const result = await pool
    .request()
    .input("referenceNumber", sql.NVarChar, enrollmentData.referenceNumber)
    .input("companyId", sql.Int, enrollmentData.companyId)
    .input("insuredName", sql.NVarChar, enrollmentData.insuredName)
    .input("nationality", sql.NVarChar, enrollmentData.nationality)
    .input("tin", sql.NVarChar, enrollmentData.tin)
    .input("region", sql.NVarChar, enrollmentData.region)
    .input("province", sql.NVarChar, enrollmentData.province)
    .input("cityMunicipality", sql.NVarChar, enrollmentData.cityMunicipality)
    .input("barangay", sql.NVarChar, enrollmentData.barangay)
    .input("streetNumber", sql.NVarChar, enrollmentData.streetNumber)
    .input("zipCode", sql.NVarChar, enrollmentData.zipCode)
    .input("placeOfBirth", sql.NVarChar, enrollmentData.placeOfBirth)
    .input("dateOfBirth", sql.Date, enrollmentData.dateOfBirth)
    .input("civilStatus", sql.NVarChar, enrollmentData.civilStatus)
    .input("gender", sql.NVarChar, enrollmentData.gender)
    .input("heightFeet", sql.Int, enrollmentData.heightFeet)
    .input("heightInches", sql.Int, enrollmentData.heightInches)
    .input("weight", sql.Decimal, enrollmentData.weight)
    .input("sssGsisNo", sql.NVarChar, enrollmentData.sssGsisNo)
    .input("contactNo", sql.NVarChar, enrollmentData.contactNo)
    .input("officeNo", sql.NVarChar, enrollmentData.officeNo)
    .input("email", sql.NVarChar, enrollmentData.email)
    .input("occupation", sql.NVarChar, enrollmentData.occupation)
    .input("placeOfWork", sql.NVarChar, enrollmentData.placeOfWork)
    .input("sourceOfIncome", sql.NVarChar, enrollmentData.sourceOfIncome)
    .input("amountOfInsurance", sql.Decimal, enrollmentData.amountOfInsurance)
    .input("consentTerms", sql.Bit, enrollmentData.consentTerms)
    .input("consentPrivacy", sql.Bit, enrollmentData.consentPrivacy)
    .input("signaturePath", sql.NVarChar, enrollmentData.signaturePath).query(`
            INSERT INTO enrollment.Enrollments (
              [ReferenceNumber],
              [CompanyID],
              [InsuredName],
              [Nationality],
              [TIN],
              [Region],
              [Province],
              [CityMunicipality],
              [Barangay],
              [StreetNumber],
              [ZipCode],
              [PlaceOfBirth],
              [DateOfBirth],
              [CivilStatus],
              [Gender],
              [HeightFeet],
              [HeightInches],
              [Weight],
              [SSSGSISNo],
              [ContactNo],
              [OfficeNo],
              [Email],
              [Occupation],
              [PlaceOfWork],
              [SourceOfIncome],
              [AmountOfInsurance],
              [ConsentPrivacy],
              [ConsentTerms],
              [SignaturePath]
            ) 
              VALUES (
                @referenceNumber,
                @companyId,
                @insuredName,
                @nationality,
                @tin,
                @region,
                @province,
                @cityMunicipality,
                @barangay,
                @streetNumber,
                @zipCode,
                @placeOfBirth,
                @dateOfBirth,
                @civilStatus,
                @gender,
                @heightFeet,
                @heightInches,
                @weight,
                @sssGsisNo,
                @contactNo,
                @officeNo,
                @email,
                @occupation,
                @placeOfWork,
                @sourceOfIncome,
                @amountOfInsurance,
                @consentPrivacy,
                @consentTerms,
                @signaturePath
              );SELECT SCOPE_IDENTITY() AS EnrollmentID;
        `);

  return result.recordset[0];
};

const findEnrollmentByEmailAndCompany = async (pool, email, companyId) => {
  const result = await pool
    .request()
    .input("email", sql.NVarChar, email)
    .input("companyId", sql.Int, companyId)
    .query(
      `SELECT [EnrollmentId] FROM [enrollment].[Enrollments] WHERE email = @email AND companyId = @companyId`,
    );

  return result.recordset[0];
};

const insertBeneficiary = async (pool, beneficiaryData) => {
  const result = await pool
    .request()
    .input("enrollmentId", sql.Int, beneficiaryData.enrollmentId)
    .input("fullName", sql.NVarChar, beneficiaryData.fullName)
    .input("age", sql.Int, beneficiaryData.age)
    .input("relationship", sql.NVarChar, beneficiaryData.relationship)
    .input(
      "coveragePercent",
      sql.Decimal,
      beneficiaryData.coveragePercent ?? null,
    )
    .query(
      `INSERT INTO [enrollment].[Beneficiaries]
        (EnrollmentId, FullName, Age, Relationship, CoveragePercent)
        VALUES (@enrollmentId, @fullName, @age, @relationship, @coveragePercent)`,
    );
};

const getEnrollmentsByCompany = async (
  pool,
  companyId,
  role,
  search,
  page = 1,
  limit = 10,
) => {
  const offset = (page - 1) * limit;
  let whereClause = "WHERE 1=1";

  if (role === "admin") {
    whereClause += " AND CompanyID = @companyId";
  }

  if (search) {
    whereClause +=
      " AND (InsuredName LIKE @search OR Email LIKE @search OR ReferenceNumber LIKE @search)";
  }

  const queryRequest = pool.request();

  if (role === "admin") {
    queryRequest.input("companyId", sql.Int, companyId);
  }

  if (search) {
    queryRequest.input("search", sql.NVarChar, `%${search}%`);
  }
  const result = await queryRequest
    .input("offset", sql.Int, offset)
    .input("limit", sql.Int, limit).query(`
      SELECT * FROM (
    SELECT 
        EnrollmentID,
        ReferenceNumber,
        CompanyID,
        InsuredName,
        Email,
        ContactNo,
        CreatedAt,
        ROW_NUMBER() OVER (ORDER BY CreatedAt DESC) AS RowNum
    FROM enrollment.Enrollments ${whereClause}
) AS Sub
WHERE RowNum > @offset AND RowNum <= @offset + @limit;

    SELECT COUNT(*) AS total FROM enrollment.Enrollments ${whereClause}
      `);

  const enrollments = result.recordsets[0];
  const total = result.recordsets[1][0].total;

  return {
    enrollments,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  };
};

const getEnrollmentById = async (pool, enrollmentId) => {
  const result = await pool
    .request()
    .input("enrollmentId", sql.Int, enrollmentId).query(`
      SELECT [EnrollmentID]
      ,[ReferenceNumber]
      ,[CompanyID]
      ,[InsuredName]
      ,[Nationality]
      ,[TIN]
      ,[PlaceOfBirth]
      ,[DateOfBirth]
      ,[CivilStatus]
      ,[Gender]
      ,[HeightFeet]
      ,[HeightInches]
      ,[Weight]
      ,[Region]
      ,[Province]
      ,[CityMunicipality]
      ,[Barangay]
      ,[StreetNumber]
      ,[ZipCode]
      ,[ContactNo]
      ,[OfficeNo]
      ,[Email]
      ,[SSSGSISNo]
      ,[Occupation]
      ,[PlaceOfWork]
      ,[SourceOfIncome]
      ,[AmountOfInsurance]
      ,[ConsentPrivacy]
      ,[ConsentTerms]
      ,[SignaturePath]
      FROM enrollment.Enrollments
      WHERE EnrollmentID = @enrollmentId;

      SELECT [BeneficiaryID]
      ,[FullName]
      ,[Relationship]
      ,[CoveragePercent]
      ,[Age]
      FROM enrollment.Beneficiaries
      WHERE EnrollmentID = @enrollmentId;
    `);

  return {
    enrollment: result.recordsets[0][0],
    beneficiaries: result.recordsets[1],
  };
};

const updateEnrollment = async (pool, enrollmentId, enrollmentData) => {
  const result = await pool
    .request()
    .input("enrollmentId", sql.Int, enrollmentId)
    .input("insuredName", sql.NVarChar, enrollmentData.insuredName)
    .input("nationality", sql.NVarChar, enrollmentData.nationality)
    .input("tin", sql.NVarChar, enrollmentData.tin)
    .input("region", sql.NVarChar, enrollmentData.region)
    .input("province", sql.NVarChar, enrollmentData.province)
    .input("cityMunicipality", sql.NVarChar, enrollmentData.cityMunicipality)
    .input("barangay", sql.NVarChar, enrollmentData.barangay)
    .input("streetNumber", sql.NVarChar, enrollmentData.streetNumber)
    .input("zipCode", sql.NVarChar, enrollmentData.zipCode)
    .input("placeOfBirth", sql.NVarChar, enrollmentData.placeOfBirth)
    .input("dateOfBirth", sql.Date, enrollmentData.dateOfBirth)
    .input("civilStatus", sql.NVarChar, enrollmentData.civilStatus)
    .input("gender", sql.NVarChar, enrollmentData.gender)
    .input("heightFeet", sql.Int, enrollmentData.heightFeet)
    .input("heightInches", sql.Int, enrollmentData.heightInches)
    .input("weight", sql.Decimal, enrollmentData.weight)
    .input("sssGsisNo", sql.NVarChar, enrollmentData.sssGsisNo)
    .input("contactNo", sql.NVarChar, enrollmentData.contactNo)
    .input("officeNo", sql.NVarChar, enrollmentData.officeNo)
    .input("email", sql.NVarChar, enrollmentData.email)
    .input("occupation", sql.NVarChar, enrollmentData.occupation)
    .input("placeOfWork", sql.NVarChar, enrollmentData.placeOfWork)
    .input("sourceOfIncome", sql.NVarChar, enrollmentData.sourceOfIncome)
    .input("amountOfInsurance", sql.Decimal, enrollmentData.amountOfInsurance)
    .input("consentPrivacy", sql.Bit, enrollmentData.consentPrivacy)
    .input("consentTerms", sql.Bit, enrollmentData.consentTerms)
    .input("signaturePath", sql.NVarChar, enrollmentData.signaturePath)
    .query(`UPDATE enrollment.Enrollments SET 
              insuredName = @insuredName,
              nationality =@nationality,
              tin = @tin,
              region = @region,
              province = @province,
              cityMunicipality = @cityMunicipality,
              barangay = @barangay,
              streetNumber = @streetNumber,
              zipCode = @zipCode,
              placeOfBirth = @placeOfBirth,
              dateOfBirth = @dateOfBirth,
              civilStatus = @civilStatus,
              gender = @gender,
              heightFeet = @heightFeet,
              heightInches = @heightInches,
              weight = @weight,
              sssGsisNo = @sssGsisNo,
              contactNo = @contactNo,
              officeNo = @officeNo,
              email = @email,
              occupation = @occupation,
              placeOfWork = @placeOfWork,
              sourceOfIncome = @sourceOfIncome,
              amountOfInsurance = @amountOfInsurance,
              consentPrivacy = @consentPrivacy,
              consentTerms = @consentTerms,
              signaturePath = @signaturePath,
              UpdatedAt = GETDATE()
             WHERE EnrollmentID = @enrollmentId
             ;`);
};

const updateBeneficiary = async (pool, beneficiaryId, beneficiaryData) => {
  const result = await pool
    .request()
    .input("beneficiaryId", sql.Int, beneficiaryId)
    .input('fullName', sql.NVarChar, beneficiaryData.fullName)
    .input('age', sql.Int, beneficiaryData.age)
    .input('relationship', sql.NVarChar, beneficiaryData.relationship)
    .input('coveragePercent', sql.Decimal, beneficiaryData.coveragePercent ?? null)
    .query(`
      UPDATE enrollment.Beneficiaries 
      SET 
          fullName = @fullName,
          age = @age,
          relationship = @relationship,
          coveragePercent = @coveragePercent,
          UpdatedAt = GETDATE()
      WHERE BeneficiaryID = @beneficiaryId
    `);
};

export default {
  insertEnrollment,
  findEnrollmentByEmailAndCompany,
  insertBeneficiary,
  getEnrollmentsByCompany,
  getEnrollmentById,
  updateEnrollment,
  updateBeneficiary
};
