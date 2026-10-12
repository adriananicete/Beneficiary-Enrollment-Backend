import { getPool } from "../config/db.js";
import ClaimModel from "../models/claimModel.js";
import ClaimService, { clientIdOf } from "../services/claimService.js";
import { AppError } from "../utils/AppError.js";
import { requirementField } from "../utils/claimDocuments.js";
import { sendStoredFile } from "../utils/storedFileResponse.js";

// The employee's side of claims, branch 3 of
// md/CLAIMS-AND-MESSAGING-DECISIONS.md. HR's side is branch 4.
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

export const getMyClaimDocument = async (req, res, next) => {
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
