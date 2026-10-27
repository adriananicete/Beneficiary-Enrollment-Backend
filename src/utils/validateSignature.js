import crypto from "crypto";
import { JPEG, PNG, matchFormat } from "./fileFormats.js";

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

// The type is read from the bytes, never from what the caller declared. The
// byte signatures, and why each is the length it is, are in fileFormats.js,
// shared with the claim documents. A signature is an image: PNG or JPEG.
const FORMATS = [PNG, JPEG];

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

  const format = matchFormat(buffer, FORMATS);

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
