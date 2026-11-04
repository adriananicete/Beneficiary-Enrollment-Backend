import crypto from "node:crypto";
import { getDetails, getTransfer, listTransfers, recordTransfer } from "../claims/detailsStore.js";
import { profileOf } from "../claims/profiles.js";
import ClaimModel from "../models/claimModel.js";
import { isNumericId } from "../middlewares/validateIdParam.js";
import { AppError } from "../utils/AppError.js";
import { contentDisposition } from "../utils/storedFileResponse.js";
import { belongsToClaim } from "./claimController.js";

// The four calls of the hand-off API (docs/claims-details/CONTRACT.md), for the claims web app.
//
// The existing procedures that read a claim are scoped to a signed-in user, and this caller has
// none. So an approved claim is read as the person who approved it (the transfer's
// reader_user_id, kept when it was queued), which is what that person could see in BES. Only an
// APPROVED claim is visible here, and nothing here changes a claim other than its transfer state.
//
// Every answer is built field by field, as the claim controller's are: the claim header holds the
// employee's email and the user ids of whoever filed and reviewed it, and none of that leaves.

const NOT_FOUND = "Claim not found";

const STATUS_FILTERS = ["QUEUED", "FAILED", "SENT", "ALL"];
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_REFERENCE = 100;
const MAX_ERROR = 500;

const sha256Of = (content) => crypto.createHash("sha256").update(content).digest("hex");

// The list's query, checked before the store is asked.
export const listQueryOf = (query) => {
  const status = query.status === undefined || query.status === "" ? "QUEUED" : query.status;

  if (!STATUS_FILTERS.includes(status))
    throw new AppError(`status must be one of ${STATUS_FILTERS.join(", ")}`, 400);

  let limit = DEFAULT_LIMIT;
  if (query.limit !== undefined && query.limit !== "") {
    limit = typeof query.limit === "string" && /^\d{1,3}$/.test(query.limit) ? Number(query.limit) : 0;

    if (limit < 1 || limit > MAX_LIMIT)
      throw new AppError(`limit must be a whole number from 1 to ${MAX_LIMIT}`, 400);
  }

  let after;
  if (query.after !== undefined && query.after !== "") {
    if (typeof query.after !== "string" || !isNumericId(query.after))
      throw new AppError("after must be a claim id", 400);

    after = query.after;
  }

  return { status, limit, after };
};

// Text, trimmed, 1 to `max` characters; anything else is a 400 naming the field.
const reportText = (value, name, max) => {
  const text = typeof value === "string" ? value.trim() : "";

  if (text === "" || text.length > max)
    throw new AppError(`${name} is required and must be ${max} characters or fewer`, 400);

  return text;
};

// { status: "SENT", reference } or { status: "FAILED", error }.
export const transferReportOf = (body) => {
  const status = body?.status;

  if (status === "SENT") return { status, reference: reportText(body.reference, "reference", MAX_REFERENCE) };
  if (status === "FAILED") return { status, error: reportText(body.error, "error", MAX_ERROR) };

  throw new AppError("status must be SENT or FAILED", 400);
};

export const listItemOf = (transfer) => ({
  claim_id: transfer.claim_id,
  claim_type_code: transfer.claim_type_code,
  profile: profileOf(transfer.claim_type_code),
  approved_at: transfer.queued_at,
  status: transfer.status,
  attempts: transfer.attempts,
});

// Not the reader's user id: that is how BES reads the claim, not the claims web app's business.
export const transferOf = (transfer) => ({
  status: transfer.status,
  queued_at: transfer.queued_at,
  attempts: transfer.attempts,
  reference: transfer.reference,
  last_error: transfer.last_error,
});

export const createIntegrationHandlers = ({ getPool }) => {
  // The transfer, and the claim as its approver reads it. A claim nobody approved has no transfer,
  // and one no longer APPROVED is not offered: both are 404, as a claim that does not exist.
  const visibleClaim = async (pool, claimId) => {
    const transfer = getTransfer(claimId);
    if (!transfer) throw new AppError(NOT_FOUND, 404);

    const found = await ClaimModel.getClaimById(pool, claimId, transfer.reader_user_id);
    if (!found.claim || found.claim.claim_status !== "APPROVED") throw new AppError(NOT_FOUND, 404);

    return { transfer, ...found };
  };

  // The procedure that lists a claim's documents may or may not return their hashes. When it does
  // not, the file is read once and hashed, so the package always carries one.
  const hashOf = async (pool, transfer, row) => {
    if (row.sha256) return row.sha256;

    const stored = await ClaimModel.getClaimDocument(pool, row.claim_document_id, transfer.reader_user_id);

    return stored ? sha256Of(stored.content) : null;
  };

  const documentOf = async (pool, req, claimId, transfer, row) => ({
    document_id: String(row.claim_document_id),
    requirement_id: String(row.requirement_id),
    requirement: row.requirement_desc,
    file_name: row.file_name,
    mime_type: row.mime_type,
    byte_size: row.byte_size,
    sha256: await hashOf(pool, transfer, row),
    download: `${req.baseUrl}/claims/${claimId}/documents/${row.claim_document_id}`,
  });

  const listClaims = async (req, res, next) => {
    try {
      const { status, limit, after } = listQueryOf(req.query);

      const { items, next_after } = listTransfers(status, limit, after);

      return res.status(200).json({ claims: items.map(listItemOf), next_after });
    } catch (error) {
      next(error);
    }
  };

  const getClaimPackage = async (req, res, next) => {
    try {
      const pool = await getPool();
      const claimId = req.params.claim_id;

      const { transfer, claim, documents } = await visibleClaim(pool, claimId);

      const described = [];
      for (const row of documents) described.push(await documentOf(pool, req, claimId, transfer, row));

      return res.status(200).json({
        claim_id: String(claim.claim_id),
        claim_type: {
          code: claim.claim_type_code,
          description: claim.claim_type_desc,
          profile: profileOf(claim.claim_type_code),
          ends_coverage: claim.ends_coverage,
        },
        status: claim.claim_status,
        filed_by_role: claim.filed_by_role,
        filed_at: claim.filed_date,
        reviewed_at: claim.reviewed_date,
        review_remarks: claim.review_remarks,
        details: getDetails(claimId),
        documents: described,
        transfer: transferOf(transfer),
      });
    } catch (error) {
      next(error);
    }
  };

  const downloadDocument = async (req, res, next) => {
    try {
      const { claim_id, document_id } = req.params;

      const pool = await getPool();

      const { transfer } = await visibleClaim(pool, claim_id);

      const document = await ClaimModel.getClaimDocument(pool, document_id, transfer.reader_user_id);

      if (!belongsToClaim(document, claim_id)) throw new AppError("Document not found", 404);

      // Not sendStoredFile: that shows a file in the page. This one is saved, and never sniffed
      // into another type. The cache headers are the router's, on every answer.
      res.setHeader("Content-Type", document.mime_type);
      res.setHeader("Content-Length", document.content.length);
      res.setHeader("Content-Disposition", contentDisposition(document.file_name, "attachment"));
      res.setHeader("X-Content-Type-Options", "nosniff");
      // Worked out from the bytes sent, so the caller can check what arrived against it.
      res.setHeader("X-Content-SHA256", sha256Of(document.content));

      return res.status(200).send(document.content);
    } catch (error) {
      next(error);
    }
  };

  const reportTransfer = async (req, res, next) => {
    try {
      const report = transferReportOf(req.body);

      const pool = await getPool();

      await visibleClaim(pool, req.params.claim_id);

      const transfer = recordTransfer(req.params.claim_id, report.status, report.reference, report.error);

      return res.status(200).json({ claim_id: transfer.claim_id, transfer: transferOf(transfer) });
    } catch (error) {
      next(error);
    }
  };

  return { listClaims, getClaimPackage, downloadDocument, reportTransfer };
};

export default { createIntegrationHandlers };
