import crypto from "crypto";

// The enrollment signature, either drawn on a canvas or a photograph of a
// signed page. The two arrive as the same thing — a file — and nothing below
// distinguishes them.
//
// The employee's file is stored exactly as they gave it: no resizing, no
// re-encoding, no EXIF stripping. That is what makes it evidence rather than a
// picture of evidence, and it is the reason this accepts megabytes rather than
// a base64 string in the JSON body.

export const MAX_SIGNATURE_BYTES = 10 * 1024 * 1024;

// Room for a phone photograph without inviting a flood through a public
// endpoint. `mediumLimiter` allows 20 submissions an hour per IP in
// production, which is the other half of that ceiling.
const MAX_SIGNATURE_MB = MAX_SIGNATURE_BYTES / (1024 * 1024);

// **The type is read from the bytes, never from the filename or the
// Content-Type the caller declared.** Both of those are things the caller
// writes, and a public endpoint takes them from a stranger holding an
// invitation link. The first bytes of a file are the only part of it that the
// format itself decides.
//
// PNG carries an eight-byte header whose first four spell "PNG" — the trailing
// CRLF and EOF bytes exist to catch a transfer that mangled line endings, and
// are worth checking for the same reason.
//
// JPEG has no single fixed header. Every variant starts SOI + the first marker,
// `FF D8 FF`, and the fourth byte varies by encoder — so three is the honest
// length to match rather than a fourth byte that would refuse some cameras.
const FORMATS = [
  { mimeType: "image/png", magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mimeType: "image/jpeg", magic: [0xff, 0xd8, 0xff] },
];

const startsWith = (buffer, magic) =>
  buffer.length >= magic.length && magic.every((byte, index) => buffer[index] === byte);

// Returns either `{ error }` or the description to store — never both, and
// never a description for a buffer that failed. Two functions, one to judge and
// one to describe, would let a caller describe something it had not judged.
export const readSignature = (buffer) => {
  if (!Buffer.isBuffer(buffer))
    return { error: "A signature is required" };

  if (buffer.length === 0)
    return { error: "The signature file is empty" };

  // Checked here as well as in the upload middleware. multer refuses an
  // oversized file before the body is buffered, which is where it has to
  // happen; this is the guard that still holds if the signature ever arrives
  // by another route.
  if (buffer.length > MAX_SIGNATURE_BYTES)
    return { error: `The signature must be ${MAX_SIGNATURE_MB}MB or smaller` };

  const format = FORMATS.find(({ magic }) => startsWith(buffer, magic));

  if (!format)
    return { error: "The signature must be a PNG or JPEG image" };

  return {
    mimeType: format.mimeType,
    byteSize: buffer.length,
    // Stored so that "the original, unmodified" is provable later rather than
    // asserted. A signature read back from the database can be hashed and
    // compared to this; without it, nothing distinguishes the file that was
    // signed from one that was replaced.
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
  };
};

export default { readSignature, MAX_SIGNATURE_BYTES };
