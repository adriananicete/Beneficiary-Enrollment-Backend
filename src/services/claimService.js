import { sql } from "../config/db.js";
import ClaimModel from "../models/claimModel.js";
import UserModel from "../models/userModel.js";
import { AppError } from "../utils/AppError.js";
import { matchDocuments } from "../utils/claimDocuments.js";
import { isNumericId } from "../middlewares/validateIdParam.js";
import { sendClaimDecisionEmail } from "./emailService.js";
import { endClientSessions } from "../realtime/realtime.js";

// Employee claims, branch 3 of md/CLAIMS-AND-MESSAGING-DECISIONS.md, on the
// procedures of DBA request 20.
//
// Takes the pool, like every service since PR #102. Everything down to
// `new sql.Transaction(pool)` is a refusal, and those are tested. The
// transaction body is not, for the reason createEnrollment gives: whether it is
// right depends on the database agreeing with us, and a fake transaction agrees
// with whatever it is told. The manual run against TEST-CLAIM proves it.

const EMPLOYEE_FILER = "EMPLOYEE";
const EMPLOYEE_ROLE = "Employee";

const NOT_FILEABLE = "This claim type cannot be filed here";

// The employee's own client id, from their user row and never from the
// request. Both the submit and the cancel are scoped by it.
export const clientIdOf = async (pool, userId) => {
  const user = await UserModel.findUserById(pool, userId);

  if (!user?.client_id) throw new AppError("No enrollment found for this account", 404);

  return user.client_id;
};

// A claim type id as text, or null. multipart sends text, but this route
// also accepts JSON, where it could be anything. String() throws on
// {"toString": 1}, which is how a 500 was reachable on the logins.
const claimTypeIdOf = (value) =>
  (typeof value === "string" || typeof value === "number") && isNumericId(value)
    ? String(value)
    : null;

// UX_claims_open is a unique INDEX, so a second claim of the same type that
// races past the procedure's 50152 check fails with 2601. That is the only
// unique index this transaction writes against, so here it can be named.
export const asOpenClaimConflict = (error) => {
  const number = error?.number ?? error?.originalError?.number;

  return number === 2601
    ? new AppError("You already have an open claim of this type", 409)
    : error;
};

// documents: req.documents from parseDocuments, each
//   { field, fileName, content, mimeType, byteSize, sha256 }
const submitClaim = async (pool, { userId, claimTypeId, documents }) => {
  const typeId = claimTypeIdOf(claimTypeId);
  if (!typeId) throw new AppError("claim_type_id is required", 400);

  const clientId = await clientIdOf(pool, userId);

  // Checked against the active list before the id is bound to anything, so
  // an id that does not exist is refused here rather than by the procedure.
  const { types, requirements } = await ClaimModel.getClaimTypes(pool, EMPLOYEE_FILER);

  if (!types.some((type) => String(type.claim_type_id) === typeId))
    throw new AppError(NOT_FILEABLE, 400);

  const matched = matchDocuments(
    requirements.filter((requirement) => String(requirement.claim_type_id) === typeId),
    documents,
  );

  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    const { claim_id: claimId } = await ClaimModel.insertClaim(transaction, {
      client_id: clientId,
      claim_type_id: typeId,
      filed_by: String(userId),
      filed_by_role: EMPLOYEE_ROLE,
    });

    for (const document of matched)
      await ClaimModel.insertClaimDocument(transaction, {
        claim_id: claimId,
        requirement_id: document.requirementId,
        file_name: document.fileName,
        content: document.content,
        mime_type: document.mimeType,
        byte_size: document.byteSize,
        sha256: document.sha256,
        uploaded_by: String(userId),
      });

    // The database's own check of the rule matchDocuments has already
    // applied. Last, so it sees every document.
    await ClaimModel.checkClaimRequirements(transaction, claimId);

    await transaction.commit();

    return { claimId };
  } catch (error) {
    await rollbackQuietly(transaction, "Claim");
    throw asOpenClaimConflict(error);
  }
};

const cancelClaim = async (pool, { userId, claimId, cancelRemarks }) => {
  const clientId = await clientIdOf(pool, userId);

  await ClaimModel.cancelClaim(pool, {
    claim_id: claimId,
    client_id: clientId,
    cancelled_by: String(userId),
    cancel_remarks: cancelRemarks,
  });
};

// Rolls back without letting a failed rollback replace the error that caused
// it. If the server has already ended the transaction, rollback() throws, and
// that would turn a mapped 4xx into a 500.
const rollbackQuietly = async (transaction, what) => {
  try {
    await transaction.rollback();
  } catch (rollbackError) {
    console.error(`${what} rollback failed:`, rollbackError);
  }
};

// A returned claim, with more documents, back to PENDING. One call, decided
// 2026-10-12, so that new documents never land on a claim that is then not
// resubmitted, or the reverse.
//
// documents: req.documents from parseDocuments, as for submitClaim.
const resubmitClaim = async (pool, { userId, claimId, documents }) => {
  // HR returned it for missing documents, so a resubmit adds at least one
  // (decided 2026-10-12). Checked before the database is asked.
  if (documents.length === 0) throw new AppError("Add at least one document to resubmit", 400);

  // Scoped to the caller by the procedure: another employee's claim comes
  // back empty and is answered like one that does not exist.
  const { claim, documents: existing, requirements } = await ClaimModel.getClaimById(
    pool,
    claimId,
    userId,
  );

  if (!claim) throw new AppError("Claim not found", 404);

  // The procedure's own 50155 sentence, before the upload is written.
  if (claim.claim_status !== "RETURNED")
    throw new AppError("Only a returned claim can be resubmitted", 409);

  // The documents the claim already has count toward what is required.
  const matched = matchDocuments(
    requirements,
    documents,
    existing.map((document) => document.requirement_id),
  );

  const clientId = await clientIdOf(pool, userId);

  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    // First, because it is the ownership check: usp_ins_claim_document does
    // not ask whose claim it is.
    await ClaimModel.resubmitClaim(transaction, claimId, clientId);

    for (const document of matched)
      await ClaimModel.insertClaimDocument(transaction, {
        claim_id: claimId,
        requirement_id: document.requirementId,
        file_name: document.fileName,
        content: document.content,
        mime_type: document.mimeType,
        byte_size: document.byteSize,
        sha256: document.sha256,
        uploaded_by: String(userId),
      });

    await ClaimModel.checkClaimRequirements(transaction, claimId);

    await transaction.commit();
  } catch (error) {
    await rollbackQuietly(transaction, "Claim resubmit");
    throw error;
  }
};

export const REVIEW_STATUSES = ["APPROVED", "REJECTED", "RETURNED"];

// HR's decision, judged before the database is asked. `status` rather than
// `decision`, to match the change request review (decided 2026-10-12).
// Remarks are required to reject or return, because they are the only thing
// that tells the employee what to fix. Text, trimmed, at most the column's
// 500.
export const reviewDecisionOf = (status, reviewRemarks) => {
  if (!REVIEW_STATUSES.includes(status))
    throw new AppError("Status must be APPROVED, REJECTED or RETURNED", 400);

  if (reviewRemarks !== undefined && reviewRemarks !== null && typeof reviewRemarks !== "string")
    throw new AppError("review_remarks must be text", 400);

  const remarks = reviewRemarks?.trim() || null;

  if (remarks && remarks.length > 500)
    throw new AppError("review_remarks must be 500 characters or fewer", 400);

  if (status !== "APPROVED" && !remarks)
    throw new AppError("Review remarks are required to reject or return a claim", 400);

  return { status, remarks };
};

// Sent after the decision has committed, and it swallows its own failures, as
// notifyDecision does for change requests. A failed email is a person not
// told; a failed decision is a record that disagrees with what HR did.
const notifyClaimDecision = async (claim, status, remarks, accountClosed) => {
  try {
    if (!claim.email_address) {
      console.error(`Claim decision email skipped: no address for claim ${claim.claim_id}`);
      return;
    }

    await sendClaimDecisionEmail({
      to: claim.email_address,
      employeeName: claim.employee_name,
      claimType: claim.claim_type_desc,
      status,
      reviewRemarks: remarks,
      accountClosed,
    });
  } catch (error) {
    console.error(`Claim decision email failed for claim ${claim.claim_id}:`, error);
  }
};

// status and remarks have already been through reviewDecisionOf.
const reviewClaim = async (pool, { userId, claimId, status, remarks }) => {
  // Read first. It settles company scoping before the procedure runs (another
  // company's claim comes back empty), and it is where the employee's address
  // comes from for the email.
  const { claim } = await ClaimModel.getClaimById(pool, claimId, userId);

  if (!claim) throw new AppError("Claim not found", 404);

  const outcome = await ClaimModel.reviewClaim(pool, {
    claim_id: claimId,
    us01_user_id: userId,
    decision: status,
    review_remarks: remarks,
  });

  // A BIT, which the driver hands back as a boolean. Read for truth.
  const accountClosed = Boolean(outcome?.account_closed);

  // The procedure ended the employee's sessions with the account. Their open
  // sockets close now rather than at the next re-check.
  if (accountClosed) endClientSessions(claim.client_id);

  await notifyClaimDecision(claim, status, remarks, accountClosed);

  return { accountClosed };
};

export default { submitClaim, cancelClaim, resubmitClaim, reviewClaim };
