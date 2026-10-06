import crypto from "crypto";
import { JPEG, PDF, PNG, matchFormat } from "./fileFormats.js";

// Supporting documents for claims: a death certificate, medical records, a
// claimant's statement. Decided 2026-10-06, md/CLAIMS-AND-MESSAGING-DECISIONS.md:
// PDF, JPG or PNG, 5MB each, at most 10 to a claim.
//
// The same shape as readSignature, for the same reason: one function judges
// and describes, so nothing can be described that was not judged.

export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const MAX_DOCUMENTS = 10;

const FORMATS = [PDF, PNG, JPEG];

// Returns either `{ error }` or the description to store, never both.
export const readDocument = (buffer) => {
  if (!Buffer.isBuffer(buffer)) return { error: "A document is required" };

  if (buffer.length === 0) return { error: "The document is empty" };

  // Also enforced by the upload parser before the file is held in memory in
  // full. This is the guard that still holds if a document ever reaches the
  // service another way.
  if (buffer.length > MAX_DOCUMENT_BYTES)
    return { error: "Each document must be 5MB or smaller" };

  const format = matchFormat(buffer, FORMATS);

  if (!format) return { error: "Documents must be PDF, JPG or PNG" };

  return {
    mimeType: format.mimeType,
    byteSize: buffer.length,
    // So that the document HR reads later can be proved to be the one that
    // was uploaded.
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
  };
};

// The name the uploader gave the file, kept only so it can be shown back. It
// is never used to find, store or type the file.
//
// The browser sends whatever the user's machine called it, and a crafted
// request can send anything. So: the last path segment only, because Windows
// and old browsers send "C:\fakepath\..." and a crafted one sends "../../";
// no control characters; at most 200 characters; never empty.
const MAX_FILE_NAME = 200;

export const cleanFileName = (name) => {
  if (typeof name !== "string") return "document";

  const lastSegment = name.split(/[\\/]/).pop();
  const cleaned = lastSegment
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, MAX_FILE_NAME);

  return cleaned || "document";
};

export default { readDocument, cleanFileName, MAX_DOCUMENT_BYTES, MAX_DOCUMENTS };
