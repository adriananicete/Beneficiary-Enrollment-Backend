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
    .input("consentTerms", sql.Bit, enrollmentData.consentTerms )
    .input("consentPrivacy", sql.Bit, enrollmentData.consentPrivacy)
    .input("signaturePath", sql.NVarChar, enrollmentData.signaturePath)
    .query(`
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
  const result = await pool.request()
  .input('email', sql.NVarChar, email)
  .input('companyId', sql.Int, companyId )
  .query(
    `SELECT [EnrollmentId] FROM [enrollment].[Enrollments] WHERE email = @email AND companyId = @companyId`
  );

  return result.recordset[0];
};

const insertBeneficiary = async (pool, beneficiaryData) => {
  const result = await pool.request()
    .input('enrollmentId', sql.Int, beneficiaryData.enrollmentId)
    .input('fullName', sql.NVarChar, beneficiaryData.fullName)
    .input('age', sql.Int, beneficiaryData.age)
    .input('relationship', sql.NVarChar, beneficiaryData.relationship)
    .input('coveragePercent', sql.Decimal, beneficiaryData.coveragePercent ?? null)
    .query(
      `INSERT INTO [enrollment].[Beneficiaries]
        (EnrollmentId, FullName, Age, Relationship, CoveragePercent)
        VALUES (@enrollmentId, @fullName, @age, @relationship, @coveragePercent)`
    )
};

export default {
  insertEnrollment, findEnrollmentByEmailAndCompany, insertBeneficiary
}