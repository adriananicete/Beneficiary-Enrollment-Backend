import { sql } from "../config/db.js";

// The insert procedure takes the whole proposed profile as parameters, plus the
// address and beneficiary changes as JSON documents it reads with OPENJSON.
//
// Every parameter defaults to NULL in the procedure, and the approval writes all
// eighteen client fields straight onto dbo.clients. So a field missing from the
// payload is stored as NULL and later clears a real value. validateEnrollmentUpdate
// is what stops that happening and must stay in front of this.
const insertChangeRequest = async (pool, changeRequestData) => {
  const result = await pool
    .request()
    .input("client_id", sql.BigInt, changeRequestData.client_id)
    .input("first_name", sql.VarChar(100), changeRequestData.first_name)
    .input("middle_name", sql.VarChar(100), changeRequestData.middle_name)
    .input("last_name", sql.VarChar(100), changeRequestData.last_name)
    .input("suffix", sql.VarChar(5), changeRequestData.suffix)
    .input("birthdate", sql.Date, changeRequestData.birthdate)
    .input("birthplace", sql.VarChar(100), changeRequestData.birthplace)
    .input("nationality", sql.VarChar(100), changeRequestData.nationality)
    .input("tin_id", sql.VarChar(20), changeRequestData.tin_id)
    .input("civil_status", sql.VarChar(20), changeRequestData.civil_status)
    .input("gender", sql.Char(1), changeRequestData.gender)
    .input("height", sql.Decimal(5, 2), changeRequestData.height)
    .input("weight", sql.Decimal(5, 2), changeRequestData.weight)
    .input("sss_gsis_no", sql.VarChar(30), changeRequestData.sss_gsis_no)
    .input("contact_no", sql.VarChar(30), changeRequestData.contact_no)
    .input("email_address", sql.VarChar(150), changeRequestData.email_address)
    .input("occupation", sql.VarChar(150), changeRequestData.occupation)
    .input(
      "source_of_income",
      sql.VarChar(150),
      changeRequestData.source_of_income,
    )
    .input(
      "signature_path",
      sql.NVarChar(500),
      changeRequestData.signature_path,
    )
    .input(
      "addresses_json",
      sql.NVarChar(sql.MAX),
      changeRequestData.addresses_json,
    )
    .input(
      "beneficiaries_json",
      sql.NVarChar(sql.MAX),
      changeRequestData.beneficiaries_json,
    )
    .input("submitted_by", sql.VarChar(50), changeRequestData.submitted_by)
    .execute("usp_ins_client_change_request");

  // The procedure returns the new id in a result set rather than an OUTPUT
  // parameter, unlike every other insert in this codebase.
  return result.recordset[0]?.clientChangeRequestId;
};

const getChangeRequestsByClient = async (pool, clientId) => {
  const result = await pool
    .request()
    .input("client_id", sql.BigInt, clientId)
    .execute("usp_sel_client_change_request_by_client");

  return result.recordset;
};

// @client_id is passed so the procedure refuses a request that is not the
// caller's own. It treats "not pending" and "not this client's" as one refusal,
// deliberately — a distinct answer for each would confirm that someone else's
// request exists.
const cancelChangeRequest = async (pool, cancelData) => {
  const result = await pool
    .request()
    .input(
      "client_change_request_id",
      sql.BigInt,
      cancelData.client_change_request_id,
    )
    .input("client_id", sql.BigInt, cancelData.client_id)
    .input("cancelled_by", sql.VarChar(50), cancelData.cancelled_by)
    .input("cancel_remarks", sql.VarChar(500), cancelData.cancel_remarks)
    .execute("usp_upd_client_change_request_cancel");

  return result.recordset[0];
};

export default {
  insertChangeRequest,
  getChangeRequestsByClient,
  cancelChangeRequest,
};
