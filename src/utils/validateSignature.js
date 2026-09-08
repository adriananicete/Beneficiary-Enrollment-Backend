import crypto from "crypto";

// The enrollment signature, either drawn on a canvas or photographed from a
// signed page. The two arrive as the same thing — image bytes — and nothing
// below distinguishes them.
//
// The photographed one is downscaled by the browser to 1600px on its longest
// edge before it is sent, which is a decision taken on 2026-09-08 once the
// business named what it needs the signature for: "did they sign, and is this
// really a signature". That is a human looking at a screen. A signature 8cm
// wide on an A4 page arrives about 430px wide, which answers that question
// comfortably.
//
// What it does NOT answer is a forensic comparison against a specimen — stroke
// pressure, breaks, ink. Nothing stored here can, because the stored file is a
// render rather than the original, and resolution not captured cannot be
// recovered later. Recorded in SIGNATURE-UPLOAD-DECISIONS.md rather than left
// to be discovered.

export const MAX_SIGNATURE_BYTES = 500 * 1024;

// A 1600px document photograph lands around 80–150KB as JPEG, so this is two
// to three times the expected size — headroom for a busy background without
// leaving room for something that was never downscaled at all.
const MAX_SIGNATURE_KB = MAX_SIGNATURE_BYTES / 1024;

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

  // Checked here as well as at the route's body limit. That limit refuses an
  // oversized request before it is parsed, which is where it has to happen —
  // and it is expressed in base64, roughly a third larger than the bytes. This
  // is the guard on the decoded size, and the one that still holds if a
  // signature ever reaches the service by another route.
  if (buffer.length > MAX_SIGNATURE_BYTES)
    return { error: `The signature must be ${MAX_SIGNATURE_KB}KB or smaller` };

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
