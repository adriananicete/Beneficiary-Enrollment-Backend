import { sql } from "../config/db.js";

const bindClientFields = (request, clientData) => {
  return request
    .input("first_name", sql.VarChar(100), clientData.first_name)
    .input("middle_name", sql.VarChar(100), clientData.middle_name)
    .input("last_name", sql.VarChar(100), clientData.last_name)
    .input("suffix", sql.VarChar(5), clientData.suffix)
    .input("birthdate", sql.Date, clientData.birthdate)
    .input("birthplace", sql.VarChar(100), clientData.birthplace)
    .input("nationality", sql.VarChar(100), clientData.nationality)
    .input("tin_id", sql.VarChar(20), clientData.tin_id)
    .input("civil_status", sql.VarChar(20), clientData.civil_status)
    .input("gender", sql.Char(1), clientData.gender)
    .input("height", sql.Decimal(5, 2), clientData.height)
    .input("weight", sql.Decimal(5, 2), clientData.weight)
    .input("sss_gsis_no", sql.VarChar(30), clientData.sss_gsis_no)
    .input("contact_no", sql.VarChar(30), clientData.contact_no)
    .input("email_address", sql.VarChar(150), clientData.email_address)
    .input("occupation", sql.VarChar(150), clientData.occupation)
    .input("source_of_income", sql.VarChar(150), clientData.source_of_income)
    .input("signature_path", sql.NVarChar(500), clientData.signature_path ?? "")
};

const insertClient = async (pool, clientData) => {
  const request = pool.request();
  const result = await bindClientFields(request, clientData)
    .input("created_by", sql.VarChar(50), clientData.created_by)
    .output("client_id", sql.BigInt)
    .execute("usp_ins_client");
  return result.output.client_id;
};

// `page_size` undefined reaches the procedure as NULL, and NULL means the whole
// set — which is why the two callers that need every row keep working without
// being told about paging. `exportService.js` is the one that matters: a page
// there would produce a spreadsheet quietly missing most of the company.
const getHrEmployees = async (pool, userId, options = {}) => {
  const result = await pool
    .request()
    .input("us01_user_id", sql.BigInt, userId)
    .input("page", sql.Int, options.page)
    .input("page_size", sql.Int, options.pageSize)
    .input("search", sql.VarChar(150), options.search ?? null)
    .execute("usp_sel_hr_employees");

  return result.recordset;
};

// Answers one question — does this client belong to this caller's company —
// rather than fetching the company to look the answer up in it. Applies the
// same scoping as usp_sel_hr_employees, and lets an Administrator past the
// same way.
//
// Returns the row or undefined. No rows is how "not yours" arrives: the
// procedure does not throw for it, so the caller decides what to say.
const getHrEmployeeByClient = async (pool, userId, clientId) => {
  const result = await pool
    .request()
    .input("client_id", sql.BigInt, clientId)
    .input("us01_user_id", sql.BigInt, userId)
    .execute("usp_sel_hr_employee_by_client");

  return result.recordset[0];
};

const getEnrollmentByClientId = async (pool, clientId) => {
  const result = await pool
    .request()
    .input("client_id", sql.BigInt, clientId)
    .execute("usp_get_insurance_enrollment_by_id");

  return result.recordset;
};

const getEnrollmentBenefitsByClientId = async (pool, clientId) => {
  const result = await pool
    .request()
    .input("client_id", sql.BigInt, clientId)
    .execute("usp_get_enrollment_benefits_by_id");

  return result.recordset;
};

const getMyEnrollment = async (pool, userId) => {
  const result = await pool
    .request()
    .input("us01_user_id", sql.BigInt, userId)
    .execute("usp_sel_insurance_enrollment");

  return result.recordset;
};

export default {
  getMyEnrollment,
  insertClient,
  getHrEmployees,
  getHrEmployeeByClient,
  getEnrollmentByClientId,
  getEnrollmentBenefitsByClientId,
};
