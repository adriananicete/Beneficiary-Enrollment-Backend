import { describe, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { cleanFileName, readDocument } from "../../src/utils/validateDocument.js";

// Claim documents, decided 2026-10-06: PDF, JPG or PNG, 5MB each. Pinned as
// literals, so changing the rule has to change these too.
const FIVE_MB = 5 * 1024 * 1024;

const withHeader = (header, size = 64) => {
  const buffer = Buffer.alloc(size, 0x20);
  Buffer.from(header).copy(buffer);
  return buffer;
};

const PDF = () => withHeader([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // %PDF-1.7
const PNG = () => withHeader([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = () => withHeader([0xff, 0xd8, 0xff, 0xe0]);

describe("readDocument — accepts", () => {
  for (const [label, make, mimeType] of [
    ["a PDF", PDF, "application/pdf"],
    ["a PNG", PNG, "image/png"],
    ["a JPEG", JPEG, "image/jpeg"],
  ])
    test(`${label}, typed from its bytes`, () => {
      const buffer = make();
      const described = readDocument(buffer);

      assert.equal(described.mimeType, mimeType);
      assert.equal(described.byteSize, buffer.length);
      assert.equal(described.sha256, crypto.createHash("sha256").update(buffer).digest("hex"));
      assert.equal(described.error, undefined);
    });

  test("exactly 5MB", () => {
    assert.equal(readDocument(withHeader("%PDF-", FIVE_MB)).mimeType, "application/pdf");
  });
});

describe("readDocument — refuses", () => {
  for (const [label, buffer] of [
    ["a GIF", withHeader("GIF89a")],
    ["a ZIP, which is also what a .docx is", withHeader([0x50, 0x4b, 0x03, 0x04])],
    ["HTML", withHeader("<html><script>")],
    ["plain text", withHeader("hello")],
    // The header must be at byte 0. Something in front of it is refused,
    // never searched for.
    ["a PDF header that is not at the start", withHeader(" %PDF-1.7")],
  ])
    test(label, () => {
      assert.deepEqual(readDocument(buffer), { error: "Documents must be PDF, JPG or PNG" });
    });

  test("5MB and one byte", () => {
    assert.deepEqual(readDocument(withHeader("%PDF-", FIVE_MB + 1)), {
      error: "Each document must be 5MB or smaller",
    });
  });

  test("an empty file", () => {
    assert.deepEqual(readDocument(Buffer.alloc(0)), { error: "The document is empty" });
  });

  test("anything that is not a Buffer", () => {
    for (const value of [undefined, null, "%PDF-1.7", [0x25]])
      assert.deepEqual(readDocument(value), { error: "A document is required" }, String(value));
  });
});

describe("cleanFileName — the name shown back, never used to store the file", () => {
  for (const [label, given, expected] of [
    ["an ordinary name", "death certificate.pdf", "death certificate.pdf"],
    ["ñ is kept", "Peña ID.jpg", "Peña ID.jpg"],
    ["a Windows path", "C:\\fakepath\\cert.pdf", "cert.pdf"],
    ["a traversal", "../../etc/passwd", "passwd"],
    ["control characters", "cert\r\n\u0000.pdf", "cert.pdf"],
    ["only spaces", "   ", "document"],
    ["empty", "", "document"],
    ["a trailing slash", "folder/", "document"],
  ])
    test(label, () => {
      assert.equal(cleanFileName(given), expected);
    });

  test("anything that is not text", () => {
    for (const value of [undefined, null, 42, {}]) assert.equal(cleanFileName(value), "document");
  });

  test("at most 200 characters", () => {
    assert.equal(cleanFileName(`${"a".repeat(300)}.pdf`).length, 200);
  });
});
