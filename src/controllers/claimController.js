import { getPool } from "../config/db.js";
import ClaimModel from "../models/claimModel.js";
import ClaimService, { clientIdOf, reviewDecisionOf } from "../services/claimService.js";
import { AppError } from "../utils/AppError.js";
import { requirementField } from "../utils/claimDocuments.js";
import { buildPage, parsePaging } from "../utils/parsePaging.js";
import { sendStoredFile } from "../utils/storedFileResponse.js";

// Claims, branches 3 and 4 of md/CLAIMS-AND-MESSAGING-DECISIONS.md: the
// employee's side, and HR's review.
//
// Every answer is built field by field rather than spread from the row. The
// detail procedure also returns the employee's email address, the user ids of
// whoever filed and reviewed the claim, and the ticketing columns. Those are
// for HR, and a spread would send them to the browser, as it nearly sent a
// password hash from /auth/me.

// A type with the documents it asks for. `field` is the multipart field each
// document is sent in, so the frontend never builds the name itself.
export const claimTypeOf = (type, requirements) => ({
  claim_type_id: type.claim_type_id,
  claim_type_code: type.claim_type_code,
  claim_type_desc: type.claim_type_desc,
  ends_coverage: type.ends_coverage,
  requirements: requirements
    .filter((requirement) => String(requirement.claim_type_id) === String(type.claim_type_id))
    .map(requirementOf),
});

export const requirementOf = (requirement) => ({
  requirement_id: requirement.requirement_id,
  requirement_desc: requirement.requirement_desc,
  is_required: requirement.is_required,
  sort_order: requirement.sort_order,
  field: requirementField(requirement.requirement_id),
});

// The list row and the detail header, the employee's view of both.
export const employeeClaimOf = (row) => ({
  claim_id: row.claim_id,
  claim_type_id: row.claim_type_id,
  claim_type_code: row.claim_type_code,
  claim_type_desc: row.claim_type_desc,
  claim_status: row.claim_status,
  filed_date: row.filed_date,
  resubmitted_date: row.resubmitted_date,
  reviewed_date: row.reviewed_date,
  review_remarks: row.review_remarks,
  cancelled_date: row.cancelled_date,
  closed_date: row.closed_date,
});

// The detail adds two the list does not carry.
export const employeeClaimDetailOf = (row) => ({
  ...employeeClaimOf(row),
  ends_coverage: row.ends_coverage,
  cancel_remarks: row.cancel_remarks,
});

// HR's view of a claim: the whole header, still named field by field, so a
// column the procedure gains later stays out until somebody adds it here.
// `filed_by`, `reviewed_by` and the rest are user ids, as text.
export const hrClaimOf = (row) => ({
  ...employeeClaimDetailOf(row),
  client_id: row.client_id,
  enrollment_id: row.enrollment_id,
  employee_name: row.employee_name,
  email_address: row.email_address,
  filed_by: row.filed_by,
  filed_by_role: row.filed_by_role,
  reviewed_by: row.reviewed_by,
  cancelled_by: row.cancelled_by,
  closed_by: row.closed_by,
  ticket_status: row.ticket_status,
  ticket_reference: row.ticket_reference,
});

// A row of HR's paged list, as usp_sel_claims_by_user returns it.
export const hrClaimListItemOf = (row) => ({
  claim_id: row.claim_id,
  client_id: row.client_id,
  employee_name: row.employee_name,
  claim_type_code: row.claim_type_code,
  claim_type_desc: row.claim_type_desc,
  claim_status: row.claim_status,
  filed_by_role: row.filed_by_role,
  filed_date: row.filed_date,
  resubmitted_date: row.resubmitted_date,
  reviewed_by: row.reviewed_by,
  reviewed_date: row.reviewed_date,
  ticket_status: row.ticket_status,
});

// A document's description. The content leaves only through its own route.
export const claimDocumentOf = (row) => ({
  claim_document_id: row.claim_document_id,
  requirement_id: row.requirement_id,
  requirement_desc: row.requirement_desc,
  file_name: row.file_name,
  mime_type: row.mime_type,
  byte_size: row.byte_size,
  uploaded_date: row.uploaded_date,
});

// The procedure scopes a document to the caller. The claim in the path must be
// the one it belongs to as well, or a URL could pair any claim with any of the
// caller's documents. Compared as text: the ids arrive as strings (BigInt)
// from the database and from the URL alike, but a number on either side once
// produced a false 403 here.
export const belongsToClaim = (document, claimId) =>
  Boolean(document) && String(document.claim_id) === String(claimId);

// Optional. Text, trimmed, at most the column's 500. Anything else is a 400
// rather than whatever the driver makes of it.
export const cancelRemarksOf = (value) => {
  if (value === undefined || value === null) return null;

  if (typeof value !== "string") throw new AppError("cancel_remarks must be text", 400);

  const remarks = value.trim();

  if (remarks.length > 500)
    throw new AppError("cancel_remarks must be 500 characters or fewer", 400);

  return remarks || null;
};

export const getMyClaimTypes = async (req, res, next) => {
  try {
    const pool = await getPool();

    const { types, requirements } = await ClaimModel.getClaimTypes(pool, "EMPLOYEE");

    return res.status(200).json({
      success: true,
      data: types.map((type) => claimTypeOf(type, requirements)),
    });
  } catch (error) {
    next(error);
  }
};

// multipart/form-data: claim_type_id, and one field per document,
// requirement_<requirement_id>. parseDocuments has already read the files.
export const submitMyClaim = async (req, res, next) => {
  try {
    const pool = await getPool();

    const { claimId } = await ClaimService.submitClaim(pool, {
      userId: req.user.user_id,
      claimTypeId: req.body?.claim_type_id,
      documents: req.documents ?? [],
    });

    return res.status(201).json({
      success: true,
      data: { claim_id: claimId, claim_status: "PENDING" },
      message: "Claim submitted",
    });
  } catch (error) {
    next(error);
  }
};

export const getMyClaims = async (req, res, next) => {
  try {
    const pool = await getPool();

    const clientId = await clientIdOf(pool, req.user.user_id);
    const claims = await ClaimModel.getClaimsByClient(pool, clientId);

    return res.status(200).json({
      success: true,
      data: claims.map(employeeClaimOf),
    });
  } catch (error) {
    next(error);
  }
};

export const getMyClaim = async (req, res, next) => {
  try {
    const pool = await getPool();

    // Scoped in the procedure by the caller's user id: another employee's
    // claim comes back empty, and is answered exactly like one that does not
    // exist.
    const { claim, documents, requirements } = await ClaimModel.getClaimById(
      pool,
      req.params.claim_id,
      req.user.user_id,
    );

    if (!claim) throw new AppError("Claim not found", 404);

    return res.status(200).json({
      success: true,
      data: {
        claim: employeeClaimDetailOf(claim),
        documents: documents.map(claimDocumentOf),
        requirements: requirements.map(requirementOf),
      },
    });
  } catch (error) {
    next(error);
  }
};

// One handler for both sides. usp_sel_claim_document scopes by the caller's
// own roles: an employee gets their own documents, HR their companies', the
// Administrator any.
export const getClaimDocument = async (req, res, next) => {
  try {
    const { claim_id, document_id } = req.params;

    const pool = await getPool();

    const document = await ClaimModel.getClaimDocument(pool, document_id, req.user.user_id);

    if (!belongsToClaim(document, claim_id)) throw new AppError("Document not found", 404);

    return sendStoredFile(res, {
      content: document.content,
      mimeType: document.mime_type,
      byteSize: document.byte_size,
      fileName: document.file_name,
    });
  } catch (error) {
    next(error);
  }
};

// The employee route's name, kept so the two routers read naturally.
export const getMyClaimDocument = getClaimDocument;

// multipart/form-data, the same requirement_<requirement_id> fields as the
// submit. At least one document.
export const resubmitMyClaim = async (req, res, next) => {
  try {
    const pool = await getPool();

    await ClaimService.resubmitClaim(pool, {
      userId: req.user.user_id,
      claimId: req.params.claim_id,
      documents: req.documents ?? [],
    });

    return res.status(200).json({
      success: true,
      data: { claim_id: req.params.claim_id, claim_status: "PENDING" },
      message: "Claim resubmitted",
    });
  } catch (error) {
    next(error);
  }
};

// The statuses CK_claims_status allows, read back 2026-10-12.
export const CLAIM_STATUSES = ["PENDING", "RETURNED", "APPROVED", "REJECTED", "CANCELLED", "CLOSED"];

// The list's optional filter. Checked against the set rather than passed
// through, because a value longer than the VarChar(20) binding is refused
// by the driver, and that refusal answers 500.
export const statusFilterOf = (value) => {
  if (value === undefined || value === "") return undefined;

  if (!CLAIM_STATUSES.includes(value))
    throw new AppError(`status must be one of ${CLAIM_STATUSES.join(", ")}`, 400);

  return value;
};

// HR's list. The procedure does the company scoping and lets an
// Administrator through unscoped, so nothing here filters.
export const getClaims = async (req, res, next) => {
  try {
    const paging = parsePaging(req.query);
    const status = statusFilterOf(req.query.status);

    const pool = await getPool();

    const claims = await ClaimModel.getClaimsByUser(pool, req.user.user_id, status, paging);

    return res.status(200).json({
      success: true,
      data: buildPage(claims, paging, hrClaimListItemOf),
    });
  } catch (error) {
    next(error);
  }
};

// The badge on HR's screen. A count of PENDING claims, not of unseen ones:
// on a shared account, a "last seen" marker would be cleared for everyone by
// whoever looked first.
export const getPendingClaimCount = async (req, res, next) => {
  try {
    const pool = await getPool();

    const pendingCount = await ClaimModel.getPendingCountByUser(pool, req.user.user_id);

    return res.status(200).json({
      success: true,
      data: { pendingCount },
    });
  } catch (error) {
    next(error);
  }
};

export const getClaimDetails = async (req, res, next) => {
  try {
    const pool = await getPool();

    const { claim, documents, requirements } = await ClaimModel.getClaimById(
      pool,
      req.params.claim_id,
      req.user.user_id,
    );

    // Another company's claim comes back empty, and is answered exactly like
    // one that does not exist.
    if (!claim) throw new AppError("Claim not found", 404);

    return res.status(200).json({
      success: true,
      data: {
        claim: hrClaimOf(claim),
        documents: documents.map(claimDocumentOf),
        requirements: requirements.map(requirementOf),
      },
    });
  } catch (error) {
    next(error);
  }
};

const REVIEWED = {
  APPROVED: "Claim approved",
  REJECTED: "Claim rejected",
  RETURNED: "Claim returned to the employee",
};

// Approve, reject or return. The decision is judged before the database is
// asked; the procedure owns the transaction, and closes the account in it
// when an approved type ends coverage.
export const reviewClaim = async (req, res, next) => {
  try {
    const { status, remarks } = reviewDecisionOf(req.body?.status, req.body?.review_remarks);

    const pool = await getPool();

    const { accountClosed } = await ClaimService.reviewClaim(pool, {
      userId: req.user.user_id,
      claimId: req.params.claim_id,
      status,
      remarks,
    });

    return res.status(200).json({
      success: true,
      data: { claim_id: req.params.claim_id, claim_status: status, account_closed: accountClosed },
      message: accountClosed
        ? "Claim approved. The employee's coverage has ended and their account is closed."
        : REVIEWED[status],
    });
  } catch (error) {
    next(error);
  }
};

export const cancelMyClaim = async (req, res, next) => {
  try {
    const cancelRemarks = cancelRemarksOf(req.body?.cancel_remarks);

    const pool = await getPool();

    await ClaimService.cancelClaim(pool, {
      userId: req.user.user_id,
      claimId: req.params.claim_id,
      cancelRemarks,
    });

    return res.status(200).json({
      success: true,
      message: "Claim cancelled",
    });
  } catch (error) {
    next(error);
  }
};
