import { sql } from "../config/db.js";
import ClaimModel from "../models/claimModel.js";
import ClientModel from "../models/clientModel.js";
import UserModel from "../models/userModel.js";
import { AppError } from "../utils/AppError.js";
import { matchDocuments } from "../utils/claimDocuments.js";
import { isNumericId } from "../middlewares/validateIdParam.js";
import { sendClaimDecisionEmail, sendClaimFiledEmail } from "./emailService.js";
import { endClientSessions } from "../realtime/realtime.js";
import { fullName } from "../utils/fullName.js";

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
const HR_FILER = "HR";

const NOT_FILEABLE = "This claim type cannot be filed here";
const DEATH_CLAIM_EXISTS = "A death claim has already been filed for this employee";
const HR_OPEN_CLAIM = "This employee already has an open claim of this type";

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
// unique index these transactions write against, so here it can be named.
// The sentence depends on who is filing.
export const asOpenClaimConflict = (error, message = "You already have an open claim of this type") => {
  const number = error?.number ?? error?.originalError?.number;

  return number === 2601 ? new AppError(message, 409) : error;
};

// usp_ins_claim's numbers are worded for the employee ("...for this account").
// For a claim HR files, the same numbers in HR's words. 50150 is also the
// procedure's answer for an employee outside HR's companies (DBA request 36),
// "not there" rather than "not yours", as everywhere else.
export const asHrFilerError = (error) => {
  const number = error?.number ?? error?.originalError?.number;

  if (number === 50150) return new AppError("No active enrollment was found for this employee", 404);
  if (number === 50152 || number === 2601) return new AppError(HR_OPEN_CLAIM, 409);

  return error;
};

// The claim type, checked against the filer's active list before its id is
// bound to anything, and the documents matched to that type's requirements.
// `filedBy` is 'EMPLOYEE' or 'HR', so neither side can reach the other's types
// by naming an id. Returns the type as well, for the email that names it.
const typeAndDocuments = async (pool, filedBy, typeId, documents) => {
  const { types, requirements } = await ClaimModel.getClaimTypes(pool, filedBy);

  const type = types.find((candidate) => String(candidate.claim_type_id) === typeId);
  if (!type) throw new AppError(NOT_FILEABLE, 400);

  return {
    type,
    matched: matchDocuments(
      requirements.filter((requirement) => String(requirement.claim_type_id) === typeId),
      documents,
    ),
  };
};

const matchedForType = async (pool, filedBy, typeId, documents) =>
  (await typeAndDocuments(pool, filedBy, typeId, documents)).matched;

// One transaction, committed or rolled back whole, with the open-claim race
// named. `work` gets the transaction and returns what the caller wants back.
const inClaimTransaction = async (pool, what, conflictMessage, work) => {
  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    const result = await work(transaction);

    await transaction.commit();

    return result;
  } catch (error) {
    await rollbackQuietly(transaction, what);
    throw asOpenClaimConflict(error, conflictMessage);
  }
};

// The claim and its documents, inside the caller's transaction, then the
// database's own check of the rule matchDocuments has already applied: last,
// so it sees every document. Returns the new claim's id.
const insertClaimWithDocuments = async (transaction, { clientId, typeId, userId, roleName, matched }) => {
  const { claim_id: claimId } = await ClaimModel.insertClaim(transaction, {
    client_id: clientId,
    claim_type_id: typeId,
    filed_by: String(userId),
    filed_by_role: roleName,
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

  await ClaimModel.checkClaimRequirements(transaction, claimId);

  return claimId;
};

// documents: req.documents from parseDocuments, each
//   { field, fileName, content, mimeType, byteSize, sha256 }
const submitClaim = async (pool, { userId, claimTypeId, documents }) => {
  const typeId = claimTypeIdOf(claimTypeId);
  if (!typeId) throw new AppError("claim_type_id is required", 400);

  const clientId = await clientIdOf(pool, userId);

  const matched = await matchedForType(pool, EMPLOYEE_FILER, typeId, documents);

  const claimId = await inClaimTransaction(pool, "Claim", undefined, (transaction) =>
    insertClaimWithDocuments(transaction, { clientId, typeId, userId, roleName: EMPLOYEE_ROLE, matched }),
  );

  return { claimId };
};

// HR files the death claim for an employee already marked deceased, branch 6.
// HR filing it is the approval (decided 2026-10-06), so it is created APPROVED
// and queued for ticketing, in the same transaction as the claim and its
// documents: usp_ins_claim inserts it PENDING, because usp_ins_claim_document
// accepts only an open claim, and usp_upd_claim_file_death approves it last.
// No email goes out (decided 2026-10-12).
//
// `roleName` is the filer's real role, HR or Administrator (decided
// 2026-10-12). The route is behind verifyClientAccess, and the procedure
// scopes HR to their companies again.
const fileDeathClaim = async (pool, { userId, roleName, clientId, claimTypeId, documents }) => {
  const typeId = claimTypeIdOf(claimTypeId);
  if (!typeId) throw new AppError("claim_type_id is required", 400);

  // Marked deceased first, checked before the upload is written. The
  // procedure checks again (50165), inside the transaction.
  const [enrollment] = await ClientModel.getEnrollmentByClientId(pool, clientId);

  if (!enrollment) throw new AppError("Enrollment not found", 404);
  if (!enrollment.date_of_death) throw new AppError("This employee is not marked deceased", 409);

  const matched = await matchedForType(pool, HR_FILER, typeId, documents);

  const claimId = await inClaimTransaction(pool, "Death claim", DEATH_CLAIM_EXISTS, async (transaction) => {
    const newClaimId = await insertClaimWithDocuments(transaction, { clientId, typeId, userId, roleName, matched });

    await ClaimModel.fileDeathClaim(transaction, newClaimId, userId);

    return newClaimId;
  });

  return { claimId };
};

// Sent after the claim has committed, and it swallows its own failures: the
// claim is filed whether or not Microsoft was reachable. `enrollment` is the
// row read before filing, which has the employee's name and address.
export const notifyClaimFiled = async (enrollment, type) => {
  try {
    if (!enrollment?.email_address) {
      console.error(`Claim filed email skipped: no address for client ${enrollment?.client_id}`);
      return;
    }

    await sendClaimFiledEmail({
      to: enrollment.email_address,
      employeeName: fullName(enrollment),
      claimType: type.claim_type_desc,
    });
  } catch (error) {
    console.error(`Claim filed email failed for client ${enrollment?.client_id}:`, error);
  }
};

// HR or the Administrator files an employee's claim for them: an employee who
// is alive but cannot file it, in hospital say (DBA request 36, decided with
// Adrian 2026-11-12). The types are the employee's; the death claim keeps its
// own route. Created PENDING and reviewed like any other claim, by somebody
// other than the filer (reviewClaim). The employee is emailed.
//
// `roleName` is the filer's real role, HR or Administrator, as on the death
// claim. The route is behind verifyClientAccess, and usp_ins_claim scopes HR
// to the employee's company again (50150).
const fileClaimForEmployee = async (pool, { userId, roleName, clientId, claimTypeId, documents }) => {
  const typeId = claimTypeIdOf(claimTypeId);
  if (!typeId) throw new AppError("claim_type_id is required", 400);

  // The active enrollment only: an ended employment has none here (DBA
  // request 39), and an ended employee files no claims.
  const [enrollment] = await ClientModel.getEnrollmentByClientId(pool, clientId);

  if (!enrollment) throw new AppError("Enrollment not found", 404);
  if (enrollment.date_of_death)
    throw new AppError("This employee is marked deceased. File the death claim instead.", 409);

  const { type, matched } = await typeAndDocuments(pool, EMPLOYEE_FILER, typeId, documents);

  let claimId;

  try {
    claimId = await inClaimTransaction(pool, "Claim filed for an employee", HR_OPEN_CLAIM, (transaction) =>
      insertClaimWithDocuments(transaction, { clientId, typeId, userId, roleName, matched }),
    );
  } catch (error) {
    throw asHrFilerError(error);
  }

  await notifyClaimFiled(enrollment, type);

  return { claimId };
};

// HR closes the death claim once it is finished outside the system, at any
// time (decided 2026-10-12). The procedure closes the employee's account in
// the same transaction and ends its sessions; the open sockets close here.
const closeDeathClaim = async (pool, { userId, claimId }) => {
  const outcome = await ClaimModel.closeClaim(pool, claimId, userId);

  // A BIT, which the driver hands back as a boolean. Read for truth.
  const accountClosed = Boolean(outcome?.account_closed);

  if (accountClosed) endClientSessions(outcome.client_id);

  return { accountClosed };
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
// The core of both resubmits. `clientIdFor(claim)` gives the client the
// procedure checks the claim against, or refuses: the employee's own, from
// their user row; for HR, the claim's own, after HR's scoped read.
//
// documents: req.documents from parseDocuments, as for submitClaim.
const resubmitWith = async (pool, { userId, claimId, documents }, clientIdFor) => {
  // HR returned it for missing documents, so a resubmit adds at least one
  // (decided 2026-10-12). Checked before the database is asked.
  if (documents.length === 0) throw new AppError("Add at least one document to resubmit", 400);

  // Scoped to the caller by the procedure: a claim they may not see comes
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

  const clientId = await clientIdFor(claim);

  // The documents the claim already has count toward what is required.
  const matched = matchDocuments(
    requirements,
    documents,
    existing.map((document) => document.requirement_id),
  );

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

// The employee's own resubmit.
const resubmitClaim = (pool, args) => resubmitWith(pool, args, () => clientIdOf(pool, args.userId));

// HR resubmits a returned claim that HR or the Administrator filed, with the
// same contract as the employee's (decided 2026-11-12). HR's read is scoped to
// its companies, so the claim's own client is the right one to check it
// against. A claim the employee filed is theirs to resubmit.
const resubmitClaimForEmployee = (pool, args) =>
  resubmitWith(pool, args, (claim) => {
    if (claim.filed_by_role === EMPLOYEE_ROLE)
      throw new AppError("The employee filed this claim, so they resubmit it", 409);

    return claim.client_id;
  });

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

  // Nobody reviews a claim they filed themselves (decided 2026-11-12): another
  // HR of the company, or the Administrator, does. An employee's own claim was
  // filed by the employee, so this only ever stops HR's own filings.
  if (String(claim.filed_by) === String(userId))
    throw new AppError(
      "You filed this claim, so another HR of the company or the Administrator must review it",
      403,
    );

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

export default {
  submitClaim,
  cancelClaim,
  resubmitClaim,
  resubmitClaimForEmployee,
  reviewClaim,
  fileDeathClaim,
  fileClaimForEmployee,
  closeDeathClaim,
};
