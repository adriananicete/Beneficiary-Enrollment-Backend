import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { contentDisposition, sendStoredFile } from "../../src/utils/storedFileResponse.js";
import { makeRes } from "../helpers/http.js";

// How every stored file leaves: the signature, and from the claims branches
// on, claim documents. The signature's own tests (signatureResponse.test.js)
// prove it still goes out exactly as before.

const stored = (overrides = {}) => ({
  content: Buffer.from("%PDF-1.7 ..."),
  mimeType: "application/pdf",
  byteSize: 12,
  ...overrides,
});

describe("sendStoredFile", () => {
  test("answers 200 with the bytes, the stored type and the stored size", () => {
    const file = stored();
    const res = makeRes();

    sendStoredFile(res, file);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, file.content);
    assert.equal(res.headers["Content-Type"], "application/pdf");
    assert.equal(res.headers["Content-Length"], 12);
  });

  // A death certificate on a shared HR machine's disk cache is the cost being
  // avoided. `private` alone would still write it to disk.
  test("is never stored by the browser", () => {
    const res = makeRes();

    sendStoredFile(res, stored());

    assert.equal(res.headers["Cache-Control"], "private, no-store");
  });

  test("with no file name it is plain inline, as the signature always was", () => {
    const res = makeRes();

    sendStoredFile(res, stored());

    assert.equal(res.headers["Content-Disposition"], "inline");
  });
});

describe("contentDisposition — the file name offered for saving", () => {
  test("an ordinary name", () => {
    assert.equal(
      contentDisposition("death certificate.pdf"),
      `inline; filename="death certificate.pdf"; filename*=UTF-8''death%20certificate.pdf`,
    );
  });

  // filename* carries it exactly; the plain parameter falls back to ASCII.
  test("ñ survives in filename*", () => {
    assert.equal(
      contentDisposition("Peña ID.jpg"),
      `inline; filename="Pe_a ID.jpg"; filename*=UTF-8''Pe%C3%B1a%20ID.jpg`,
    );
  });

  // Neither parameter can be broken out of, and the header never carries a
  // character that would end it.
  test("quotes, backslashes and line breaks cannot escape the header", () => {
    const header = contentDisposition('a"b\\c\r\nX-Injected: 1.pdf');

    assert.ok(!/[\r\n]/.test(header), header);
    assert.equal(header.split('"').length, 3, header);
    assert.match(header, /filename\*=UTF-8''a%22b%5Cc%0D%0AX-Injected%3A%201\.pdf$/);
  });

  test("' ( ) * are percent-encoded in filename*, which encodeURIComponent leaves alone", () => {
    assert.match(contentDisposition("it's (1)*.pdf"), /filename\*=UTF-8''it%27s%20%281%29%2A\.pdf$/);
  });
});
