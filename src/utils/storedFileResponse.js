// Sends a file held in the database: the enrollment signature, and from the
// claims branches on, claim documents. One place decides how a stored file
// leaves, for the reason escapeHtml was written once: two copies of a response
// shape drift, and the half that drifts is usually the one nobody looked at.
//
// Generalised from signatureResponse.js on 2026-10-06. The signature still
// goes out exactly as before, through sendSignature.

// RFC 5987 encoding for the filename* parameter. encodeURIComponent leaves
// ' ( ) * alone, and those are not allowed there.
const encodeExtValue = (value) =>
  encodeURIComponent(value).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

// The plain filename= parameter, for clients that ignore filename*. Printable
// ASCII only, with no quote or backslash, so the header cannot be broken out
// of. Node also refuses to set a header holding a character it cannot carry,
// which would turn an unusual name into a 500.
const asciiFallback = (value) => value.replace(/[^\x20-\x7e]|["\\]/g, "_");

// "inline" renders in the page rather than downloading. A file name, when
// there is one, is offered for "save as".
export const contentDisposition = (fileName) =>
  fileName
    ? `inline; filename="${asciiFallback(fileName)}"; filename*=UTF-8''${encodeExtValue(fileName)}`
    : "inline";

export const sendStoredFile = (res, { content, mimeType, byteSize, fileName }) => {
  // The stored type, resolved from the file's own first bytes when it was
  // uploaded. Never a guess, and never taken from the name.
  res.setHeader("Content-Type", mimeType);
  res.setHeader("Content-Length", byteSize);
  res.setHeader("Content-Disposition", contentDisposition(fileName));

  // Not cached, and this is a deliberate trade against the obvious one.
  // Caching would save re-fetching a file when HR reopens a record, at the cost
  // of leaving a copy of somebody's signature or death certificate in the disk
  // cache of whatever machine displayed it. HR machines are shared. `private`
  // alone keeps it out of proxies and still writes it to disk, which is the
  // part that matters.
  res.setHeader("Cache-Control", "private, no-store");

  return res.status(200).send(content);
};

export default { sendStoredFile, contentDisposition };
