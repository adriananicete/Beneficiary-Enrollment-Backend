import { sql } from "../config/db.js";

// Employee claims, DBA request 20. Every procedure was read back on 2026-10-12
// and is in md/DBA-PROCEDURES.md. None declares an OUTPUT parameter: the new
// ids come back in a result set, so nothing here calls .output().
//
// Five of these run inside the caller's transaction and open none of their
// own (read back, sys.sql_modules): insertClaim, insertClaimDocument,
// checkClaimRequirements, resubmitClaim and fileDeathClaim. They take the
// transaction where the others take the pool. reviewClaim and closeClaim own
// their transactions.

// Two result sets: the active types for this filer, then their active
// requirements. `filedBy` is 'EMPLOYEE' or 'HR', in capitals, the values
// CK_claim_types_filed_by allows.
const getClaimTypes = async (pool, filedBy) => {
  const result = await pool
    .request()
    .input("filed_by", sql.VarChar(10), filedBy)
    .execute("usp_sel_claim_types");

  const [types = [], requirements = []] = result.recordsets ?? [];

  return { types, requirements };
};

// Returns { claim_id, enrollment_id }. The procedure finds the active
// enrollment itself and refuses a second open claim of the same type (50152),
// with UX_claims_open behind it for a race.
//
// `filed_by_role` is 'Employee' or 'HR' in mixed case, unlike filed_by above.
// The procedure reads anything other than 'Employee' as HR.
const insertClaim = async (transaction, claim) => {
  const result = await transaction
    .request()
    .input("client_id", sql.BigInt, claim.client_id)
    .input("claim_type_id", sql.BigInt, claim.claim_type_id)
    .input("filed_by", sql.VarChar(50), claim.filed_by)
    .input("filed_by_role", sql.VarChar(20), claim.filed_by_role)
    .execute("usp_ins_claim");

  return result.recordset[0];
};

// `content` is VarBinary(MAX) against a VARBINARY(MAX) column. The signature
// travelled as a string into NVarChar(500) once, and every one was cut at 500
// characters with nothing reporting it. `file_name` is NVarChar, because names
// carry ñ.
const insertClaimDocument = async (transaction, document) => {
  const result = await transaction
    .request()
    .input("claim_id", sql.BigInt, document.claim_id)
    .input("requirement_id", sql.BigInt, document.requirement_id)
    .input("file_name", sql.NVarChar(200), document.file_name)
    .input("content", sql.VarBinary(sql.MAX), document.content)
    .input("mime_type", sql.VarChar(30), document.mime_type)
    .input("byte_size", sql.Int, document.byte_size)
    .input("sha256", sql.Char(64), document.sha256)
    .input("uploaded_by", sql.VarChar(50), document.uploaded_by)
    .execute("usp_ins_claim_document");

  return result.recordset[0]?.claim_document_id;
};

// Throws 50154 when a required document is missing, and returns nothing.
// Called last, after every document is in.
const checkClaimRequirements = async (transaction, claimId) => {
  await transaction
    .request()
    .input("claim_id", sql.BigInt, claimId)
    .execute("usp_chk_claim_requirements");
};

// No role check and no scoping in the procedure. The caller passes the
// employee's own client_id, taken from their user row, never from the request.
const getClaimsByClient = async (pool, clientId) => {
  const result = await pool
    .request()
    .input("client_id", sql.BigInt, clientId)
    .execute("usp_sel_claims_by_client");

  return result.recordset;
};

// Three result sets, read by position, as getChangeRequestById reads its four:
//
//   [0] the claim, joined to its type and the employee
//   [1] its documents, without their content
//   [2] the requirements of its type
//
// A claim the caller may not see comes back as three empty sets rather than a
// THROW, so `claim` is null and the 404 is the caller's to make.
const getClaimById = async (pool, claimId, userId) => {
  const result = await pool
    .request()
    .input("claim_id", sql.BigInt, claimId)
    .input("us01_user_id", sql.BigInt, userId)
    .execute("usp_sel_claim_by_id");

  const [header = [], documents = [], requirements = []] = result.recordsets ?? [];

  return { claim: header[0] ?? null, documents, requirements };
};

// One file with its content, or undefined when the caller may not see it.
const getClaimDocument = async (pool, documentId, userId) => {
  const result = await pool
    .request()
    .input("claim_document_id", sql.BigInt, documentId)
    .input("us01_user_id", sql.BigInt, userId)
    .execute("usp_sel_claim_document");

  return result.recordset[0];
};

// A returned claim back to PENDING, inside the caller's transaction, and the
// ownership check for everything after it: usp_ins_claim_document does not
// check whose claim it is, so this runs first. Scoped by client_id; "not
// yours" and "not returned" are one refusal, 50155.
const resubmitClaim = async (transaction, claimId, clientId) => {
  await transaction
    .request()
    .input("claim_id", sql.BigInt, claimId)
    .input("client_id", sql.BigInt, clientId)
    .execute("usp_upd_claim_resubmit");
};

// HR's list. The procedure checks the role (50157), lets an Administrator
// through unscoped, and scopes HR to their companies. `page_size` undefined
// reaches it as NULL, which means the whole set, as with change requests.
const getClaimsByUser = async (pool, userId, claimStatus, paging = {}) => {
  const result = await pool
    .request()
    .input("us01_user_id", sql.BigInt, userId)
    .input("claim_status", sql.VarChar(20), claimStatus ?? null)
    .input("page", sql.Int, paging.page)
    .input("page_size", sql.Int, paging.pageSize)
    .execute("usp_sel_claims_by_user");

  return result.recordset;
};

// The badge. No role check in the procedure, so the route's allowedRoles is
// the whole of that rule.
const getPendingCountByUser = async (pool, userId) => {
  const result = await pool
    .request()
    .input("us01_user_id", sql.BigInt, userId)
    .execute("usp_sel_claims_pending_count_by_user");

  return result.recordset[0]?.pending_count ?? 0;
};

// Approve, reject or return. The procedure owns its transaction. Approving a
// type that ends coverage also closes the account and ends its sessions in
// that same transaction, and says so in account_closed. Returns
// { claim_id, claim_status, client_id, account_closed }.
const reviewClaim = async (pool, reviewData) => {
  const result = await pool
    .request()
    .input("claim_id", sql.BigInt, reviewData.claim_id)
    .input("us01_user_id", sql.BigInt, reviewData.us01_user_id)
    .input("decision", sql.VarChar(20), reviewData.decision)
    .input("review_remarks", sql.VarChar(500), reviewData.review_remarks)
    .execute("usp_upd_claim_review");

  return result.recordset[0];
};

// The death claim, DBA request 21: approves the claim just inserted, inside
// the caller's transaction and last, and queues it for ticketing. It opens no
// transaction of its own (read back 2026-10-12). It refuses an employee not
// marked deceased (50165) and a second death claim (50166), and holds a lock
// on the deceased row until the caller commits.
const fileDeathClaim = async (transaction, claimId, userId) => {
  await transaction
    .request()
    .input("claim_id", sql.BigInt, claimId)
    .input("us01_user_id", sql.BigInt, userId)
    .execute("usp_upd_claim_file_death");
};

// Closes an APPROVED death claim and the employee's account, in one
// transaction the procedure owns: us01_is_active = 0 and the token version
// raised. Returns { claim_id, client_id, account_closed }.
const closeClaim = async (pool, claimId, userId) => {
  const result = await pool
    .request()
    .input("claim_id", sql.BigInt, claimId)
    .input("us01_user_id", sql.BigInt, userId)
    .execute("usp_upd_claim_close");

  return result.recordset[0];
};

// Scoped by client_id. "Not yours" and "no longer open" are one refusal,
// 50156.
const cancelClaim = async (pool, cancelData) => {
  await pool
    .request()
    .input("claim_id", sql.BigInt, cancelData.claim_id)
    .input("client_id", sql.BigInt, cancelData.client_id)
    .input("cancelled_by", sql.VarChar(50), cancelData.cancelled_by)
    .input("cancel_remarks", sql.VarChar(500), cancelData.cancel_remarks)
    .execute("usp_upd_claim_cancel");
};

export default {
  getClaimTypes,
  insertClaim,
  insertClaimDocument,
  checkClaimRequirements,
  getClaimsByClient,
  getClaimById,
  getClaimDocument,
  resubmitClaim,
  getClaimsByUser,
  getPendingCountByUser,
  reviewClaim,
  fileDeathClaim,
  closeClaim,
  cancelClaim,
};
