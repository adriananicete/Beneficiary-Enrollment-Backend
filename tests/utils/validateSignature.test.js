import { describe, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";

import {
  readSignature,
  MAX_SIGNATURE_BYTES,
} from "../../src/utils/validateSignature.js";

// The signature arrives on the PUBLIC enrollment endpoint, from a stranger
// holding an invitation link, with no account behind it. Everything below is
// about not trusting what that caller says about their own file.

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

const fileOf = (magic, totalBytes = 64) =>
  Buffer.concat([
    Buffer.from(magic),
    Buffer.alloc(Math.max(0, totalBytes - magic.length), 0x2a),
  ]);

describe("readSignature — resolving the type", () => {
  test("a PNG resolves as image/png", () => {
    const result = readSignature(fileOf(PNG_MAGIC));

    assert.equal(result.mimeType, "image/png");
    assert.equal(result.error, undefined);
  });

  test("a JPEG resolves as image/jpeg", () => {
    const result = readSignature(fileOf(JPEG_MAGIC));

    assert.equal(result.mimeType, "image/jpeg");
  });

  // The highest-value assertion in the file. A caller controls the filename and
  // the Content-Type; they do not control what the format itself writes into
  // the first bytes. Nothing in readSignature is even offered the declaration,
  // which is the point — there is no parameter to be fooled through.
  test("a JPEG is a JPEG however it is labelled", () => {
    const jpegBytes = fileOf(JPEG_MAGIC);

    // The same buffer a caller might send as "signature.png", declared
    // image/png. It resolves by content regardless.
    const result = readSignature(jpegBytes);

    assert.equal(result.mimeType, "image/jpeg");
    assert.notEqual(result.mimeType, "image/png");
  });

  // The PNG header is eight bytes, and the trailing four exist to catch a
  // transfer that mangled line endings. Matching only the first four would
  // accept a file that arrived corrupted.
  test("a truncated PNG header is refused", () => {
    const result = readSignature(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    assert.match(result.error, /PNG or JPEG/);
  });
});

describe("readSignature — refusing", () => {
  for (const [label, buffer] of [
    ["a text file", Buffer.from("this is not an image at all", "utf8")],
    ["a zip", Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00])],
    ["a PDF", Buffer.from("%PDF-1.7\n", "utf8")],
    ["a GIF", Buffer.from("GIF89a", "utf8")],
  ]) {
    test(`refuses ${label}`, () => {
      const result = readSignature(buffer);

      assert.match(result.error, /PNG or JPEG/);
      assert.equal(result.mimeType, undefined, "described a file it refused");
    });
  }

  test("refuses an empty file, and says so rather than calling it the wrong format", () => {
    const result = readSignature(Buffer.alloc(0));

    assert.match(result.error, /empty/);
  });

  test("refuses anything that is not a buffer", () => {
    for (const value of [undefined, null, "", "a string", 42, {}]) {
      assert.ok(readSignature(value).error, `${typeof value} was not refused`);
    }
  });
});

describe("readSignature — the size cap", () => {
  // Pinned as arithmetic on the constant either side of the boundary rather
  // than as a bare number, so the cap can move without rewriting the test —
  // but the BEHAVIOUR at the boundary is pinned exactly.
  test("accepts a file one byte under the cap", () => {
    const result = readSignature(fileOf(PNG_MAGIC, MAX_SIGNATURE_BYTES - 1));

    assert.equal(result.mimeType, "image/png");
    assert.equal(result.byteSize, MAX_SIGNATURE_BYTES - 1);
  });

  test("accepts a file exactly at the cap", () => {
    const result = readSignature(fileOf(PNG_MAGIC, MAX_SIGNATURE_BYTES));

    assert.equal(result.byteSize, MAX_SIGNATURE_BYTES);
  });

  test("refuses a file one byte over the cap", () => {
    const result = readSignature(fileOf(PNG_MAGIC, MAX_SIGNATURE_BYTES + 1));

    assert.match(result.error, /500KB or smaller/);
  });

  // The message has to name a number the employee can act on. "Too large" sends
  // them back to try the same photograph again.
  //
  // In practice they should never meet it: the browser downscales to 1600px
  // before sending, which lands well under the cap. Reaching this means the
  // downscale did not run, and the message is what tells them so.
  test("the refusal names the limit", () => {
    const result = readSignature(fileOf(PNG_MAGIC, MAX_SIGNATURE_BYTES + 1));

    assert.match(result.error, /500KB/);
  });
});

describe("readSignature — what is stored", () => {
  test("reports the byte size of the file as it arrived", () => {
    const result = readSignature(fileOf(JPEG_MAGIC, 4096));

    assert.equal(result.byteSize, 4096);
  });

  // The proof that "the original, unmodified" is true rather than intended. A
  // signature read back from the database can be hashed and compared to this.
  test("hashes the exact bytes, matching an independent digest", () => {
    const bytes = fileOf(PNG_MAGIC, 1024);

    const result = readSignature(bytes);
    const expected = crypto.createHash("sha256").update(bytes).digest("hex");

    assert.equal(result.sha256, expected);
    assert.equal(result.sha256.length, 64);
  });

  test("one byte of difference changes the hash", () => {
    const original = fileOf(PNG_MAGIC, 1024);
    const altered = Buffer.from(original);
    altered[600] = altered[600] ^ 0xff;

    assert.notEqual(readSignature(original).sha256, readSignature(altered).sha256);
  });
});
