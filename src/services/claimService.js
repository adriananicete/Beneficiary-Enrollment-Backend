import { sql } from "../config/db.js";
import ClaimModel from "../models/claimModel.js";
import UserModel from "../models/userModel.js";
import { AppError } from "../utils/AppError.js";
import { matchDocuments } from "../utils/claimDocuments.js";
import { isNumericId } from "../middlewares/validateIdParam.js";

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
    // The rollback must not replace the error that caused it. If the server
    // has already ended the transaction, rollback() throws, and that would
    // turn a mapped 409 into a 500.
    try {
      await transaction.rollback();
    } catch (rollbackError) {
      console.error("Claim rollback failed:", rollbackError);
    }

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

export default { submitClaim, cancelClaim };
