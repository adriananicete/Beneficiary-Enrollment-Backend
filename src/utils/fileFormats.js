// The file types this system accepts, identified by their first bytes.
//
// **The type is read from the bytes, never from the filename or the
// Content-Type the caller declared.** Both of those are things the caller
// writes, and the public enrollment route takes them from a stranger holding
// an invitation link. The first bytes of a file are the only part of it that
// the format itself decides.
//
// One list for the signature (validateSignature.js) and the claim documents
// (validateDocument.js), so the two cannot drift. Moved here from
// validateSignature.js on 2026-10-06, when documents needed PDF as well.

// PNG carries an eight-byte header whose first four spell "PNG". The trailing
// CRLF and EOF bytes exist to catch a transfer that mangled line endings, and
// are worth checking for the same reason.
export const PNG = {
  mimeType: "image/png",
  magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
};

// JPEG has no single fixed header. Every variant starts SOI + the first
// marker, `FF D8 FF`, and the fourth byte varies by encoder, so three is the
// honest length to match rather than a fourth byte that would refuse some
// cameras.
export const JPEG = { mimeType: "image/jpeg", magic: [0xff, 0xd8, 0xff] };

// "%PDF-". The specification lets the header sit anywhere in the first 1,024
// bytes, and some readers tolerate leading junk. Every PDF writer and scanner
// puts it first, so it is required at byte 0. A file with something in front
// of it is refused rather than guessed at.
export const PDF = { mimeType: "application/pdf", magic: [0x25, 0x50, 0x44, 0x46, 0x2d] };

const startsWith = (buffer, magic) =>
  buffer.length >= magic.length && magic.every((byte, index) => buffer[index] === byte);

// The first of `formats` whose bytes the buffer starts with, or undefined.
export const matchFormat = (buffer, formats) =>
  formats.find(({ magic }) => startsWith(buffer, magic));

export default { PNG, JPEG, PDF, matchFormat };
