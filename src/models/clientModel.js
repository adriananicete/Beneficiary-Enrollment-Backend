import { sql } from "../config/db.js";

const insertClient = async (pool, clientData) => {
  const result = await pool
    .request()
    .input("first_name", sql.VarChar, clientData.first_name)
    .input("middle_name", sql.VarChar, clientData.middle_name)
    .input("last_name", sql.VarChar, clientData.last_name)
    .input("suffix", sql.VarChar, clientData.suffix)
    .input("birthdate", sql.Date, clientData.birthdate)
    .input("birthplace", sql.VarChar, clientData.birthplace)
    .input("nationality", sql.VarChar, clientData.nationality)
    .input("tin_id", sql.VarChar, clientData.tin_id)
    .input("civil_status", sql.VarChar, clientData.civil_status)
    .input("gender", sql.Char, clientData.gender)
    .input("height", sql.Decimal, clientData.height)
    .input("weight", sql.Decimal(5,2), clientData.weight)
    .input("sss_gsis_no", sql.VarChar, clientData.sss_gsis_no)
    .input("contact_no", sql.VarChar, clientData.contact_no)
    .input("email_address", sql.VarChar, clientData.email_address)
    .input("occupation", sql.VarChar, clientData.occupation)
    .input("source_of_income", sql.VarChar, clientData.source_of_income)
    .input("signature_path", sql.NVarChar, clientData.signature_path)
    .input("created_by", sql.VarChar, clientData.created_by)
    .output("client_id", sql.BigInt)
    .execute("usp_ins_client");

  return result.output.client_id;
};

const updateClient = async (pool, clientData) => {
  await pool
    .request()
    .input("client_id", sql.BigInt, clientData.client_id)
    .input("first_name", sql.VarChar, clientData.first_name)
    .input("middle_name", sql.VarChar, clientData.middle_name)
    .input("last_name", sql.VarChar, clientData.last_name)
    .input("suffix", sql.VarChar, clientData.suffix)
    .input("birthdate", sql.Date, clientData.birthdate)
    .input("birthplace", sql.VarChar, clientData.birthplace)
    .input("nationality", sql.VarChar, clientData.nationality)
    .input("tin_id", sql.VarChar, clientData.tin_id)
    .input("civil_status", sql.VarChar, clientData.civil_status)
    .input("gender", sql.Char, clientData.gender)
    .input("height", sql.Decimal, clientData.height)
    .input("weight", sql.Decimal, clientData.weight)
    .input("sss_gsis_no", sql.VarChar, clientData.sss_gsis_no)
    .input("contact_no", sql.VarChar, clientData.contact_no)
    .input("email_address", sql.VarChar, clientData.email_address)
    .input("occupation", sql.VarChar, clientData.occupation)
    .input("source_of_income", sql.VarChar, clientData.source_of_income)
    .input("signature_path", sql.NVarChar, clientData.signature_path)
    .input("modified_by", sql.VarChar, clientData.modified_by)
    .execute("usp_upd_client");
};

const getHrEmployees = async (pool, userId) => {
  const result = await pool.request()
  .input('us01_user_id', sql.BigInt, userId)
  .execute('usp_sel_hr_employees');

  return result.recordset;
};

const getEnrollmentByClientId = async (pool, clientId) => {
  const result = await pool.request()
  .input('client_id', sql.BigInt, clientId)
  .execute('usp_get_insurance_enrollment_by_id');

  return result.recordset;
};

const getEnrollmentBenefitsByClientId = async (pool, clientId) => {
  const result = await pool.request()
  .input('client_id', sql.BigInt, clientId)
  .execute('usp_get_enrollment_benefits_by_id');

  return result.recordset;
};

const getMyEnrollment = async (pool, userId) => {
  const result = await pool.request()
  .input('us01_user_id', sql.BigInt, userId)
  .execute('usp_sel_insurance_enrollment');

  return result.recordset;
}; 

const getOwnershipIds = async (pool, clientId) => {
  const result = await pool.request()
  .input('client_id', sql.BigInt, clientId)
  .query(`SELECT 
    ca.client_address_id,
    b.beneficiary_id
FROM dbo.insurance_enrollment ie
LEFT JOIN dbo.client_address ca ON ie.client_id = ca.client_id
LEFT JOIN dbo.beneficiaries b ON ie.enrollment_id = b.enrollment_id
WHERE ie.client_id = @client_id AND ie.status = 'A';`)
  return result.recordset
}

export default {
  getMyEnrollment,
  insertClient,
  updateClient,
  getHrEmployees,
  getEnrollmentByClientId,
  getEnrollmentBenefitsByClientId,
  getOwnershipIds
};


