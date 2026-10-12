import { AppError } from "./AppError.js";

// Which uploaded file answers which document a claim type asks for. Decided
// 2026-10-12: one multipart field per requirement, named after its id, and a
// field may carry more than one file (a medical record of several pages).
// parseDocuments accepts any field name; this is where the names are judged.
//
// Checked before the claim's transaction opens, so a claim with a missing
// document is refused before anything is written. usp_chk_claim_requirements
// checks the same rule again inside the transaction, and that is the guard
// that holds if a requirement changes in between.

const FIELD = /^requirement_(\d+)$/;

export const requirementField = (requirementId) => `requirement_${requirementId}`;

// The requirement id a field names, as text, or null. Text because the ids
// arrive from the database as strings (BigInt), and comparing a string with a
// number is how a false 403 once shipped here.
export const requirementIdOf = (field) => FIELD.exec(field)?.[1] ?? null;

// `requirements` are the active requirements of ONE claim type. Returns the
// documents, each with the requirement id it answers, or throws a 400 that
// names what is wrong.
//
// `alreadyProvided` holds the requirement ids a claim already has a document
// for. A resubmit adds to the documents a claim was filed with, so those
// count toward what is required.
export const matchDocuments = (requirements, documents, alreadyProvided = []) => {
  const known = new Map(
    requirements.map((requirement) => [String(requirement.requirement_id), requirement]),
  );

  const matched = documents.map((document) => {
    const requirementId = requirementIdOf(document.field);

    // A field that is not a requirement of this type. Named, so the frontend
    // can see which one it sent wrong.
    if (requirementId === null || !known.has(requirementId))
      throw new AppError(`${document.field} is not a document this claim type asks for`, 400);

    return { ...document, requirementId };
  });

  const provided = new Set([
    ...alreadyProvided.map(String),
    ...matched.map((document) => document.requirementId),
  ]);

  // is_required is a BIT, which the driver hands back as a boolean. Read for
  // truth rather than compared with 1, the lesson of the invitation resend
  // guard.
  const missing = requirements.filter(
    (requirement) => requirement.is_required && !provided.has(String(requirement.requirement_id)),
  );

  if (missing.length)
    throw new AppError(
      `Missing required documents: ${missing.map((requirement) => requirement.requirement_desc).join(", ")}`,
      400,
    );

  return matched;
};

export default { requirementField, requirementIdOf, matchDocuments };
