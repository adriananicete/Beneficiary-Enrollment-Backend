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

// `page_size` undefined reaches the procedure as NULL, which means the whole
// set — the same behaviour this had before paging existed. Nothing that calls
// it without paging changes.
//
// VarChar(20) matches the procedure's own declaration. It was VarChar(10),
// which held every status in use but would have truncated a longer one
// silently, and this project has been bitten by silent truncation before.
const getChangeRequestsByUser = async (pool, userId, requestStatus, paging = {}) => {
  const result = await pool
    .request()
    .input("us01_user_id", sql.BigInt, userId)
    .input("request_status", sql.VarChar(20), requestStatus ?? null)
    .input("page", sql.Int, paging.page)
    .input("page_size", sql.Int, paging.pageSize)
    .execute("usp_sel_client_change_requests_by_user");

  return result.recordset;
};

const getPendingCountByUser = async (pool, userId) => {
  const result = await pool
    .request()
    .input("us01_user_id", sql.BigInt, userId)
    .execute("usp_sel_client_change_request_pending_count");

  return result.recordset[0]?.pendingCount ?? 0;
};

// The only procedure in this codebase that returns more than one result set, so
// this is the only place `recordsets` appears. They are read by position:
//
//   [0] the request header joined to the full proposed profile — empty when the
//       request belongs to another company, which is how scoping is expressed
//   [1] the changed fields only, current beside proposed, computed in SQL
//   [2] the proposed address actions
//   [3] the proposed beneficiary actions
//
// Position is the contract. If the procedure ever reorders its SELECTs this
// silently returns the wrong data rather than failing, so any change to it has
// to be checked against this function.
const getChangeRequestById = async (pool, requestId, userId) => {
  const result = await pool
    .request()
    .input("client_change_request_id", sql.BigInt, requestId)
    .input("us01_user_id", sql.BigInt, userId)
    .execute("usp_sel_client_change_request_by_id");

  const [header = [], changedFields = [], addresses = [], beneficiaries = []] =
    result.recordsets;

  return {
    request: header[0] ?? null,
    changedFields,
    addresses,
    beneficiaries,
  };
};

// Applies the change and marks the request approved, in one transaction the
// procedure owns. Nothing is applied on this side.
const approveChangeRequest = async (pool, approvalData) => {
  const result = await pool
    .request()
    .input(
      "client_change_request_id",
      sql.BigInt,
      approvalData.client_change_request_id,
    )
    .input("reviewed_by", sql.VarChar(50), approvalData.reviewed_by)
    .input("review_remarks", sql.VarChar(500), approvalData.review_remarks)
    .execute("usp_upd_client_change_request_approve");

  return result.recordset[0];
};

const rejectChangeRequest = async (pool, rejectionData) => {
  const result = await pool
    .request()
    .input(
      "client_change_request_id",
      sql.BigInt,
      rejectionData.client_change_request_id,
    )
    .input("reviewed_by", sql.VarChar(50), rejectionData.reviewed_by)
    .input("review_remarks", sql.VarChar(500), rejectionData.review_remarks)
    .execute("usp_upd_client_change_request_reject");

  return result.recordset[0];
};

export default {
  insertChangeRequest,
  getChangeRequestsByClient,
  cancelChangeRequest,
  getChangeRequestsByUser,
  getPendingCountByUser,
  getChangeRequestById,
  approveChangeRequest,
  rejectChangeRequest,
};
