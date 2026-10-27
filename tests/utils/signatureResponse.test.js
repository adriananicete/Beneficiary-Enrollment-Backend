import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { sendSignature } from "../../src/utils/signatureResponse.js";
import { makeRes } from "../helpers/http.js";

// The only response in this API that is not JSON. Two routes send it — HR
// viewing an enrollment and the employee viewing their own — and both go
// through here, so this is where the shape is decided and the only place it can
// drift from.

const storedSignature = (overrides = {}) => ({
  content: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x2a, 0x2a]),
  mime_type: "image/png",
  byte_size: 10,
  sha256: "a".repeat(64),
  ...overrides,
});

describe("sendSignature", () => {
  test("answers 200 with the bytes themselves", () => {
    const signature = storedSignature();
    const res = makeRes();

    sendSignature(res, signature);

    assert.equal(res.statusCode, 200);
    assert.ok(Buffer.isBuffer(res.body));
    assert.deepEqual(res.body, signature.content);
  });

  // The stored type, resolved from the image's own first bytes when it was
  // submitted. Nothing here re-derives it and nothing guesses from a filename,
  // because there is no filename.
  test("declares the stored mime type", () => {
    const res = makeRes();

    sendSignature(res, storedSignature({ mime_type: "image/jpeg" }));

    assert.equal(res.headers["Content-Type"], "image/jpeg");
  });

  test("declares the stored byte size", () => {
    const res = makeRes();

    sendSignature(res, storedSignature({ byte_size: 4096 }));

    assert.equal(res.headers["Content-Length"], 4096);
  });

  test("renders in the page rather than downloading", () => {
    const res = makeRes();

    sendSignature(res, storedSignature());

    assert.equal(res.headers["Content-Disposition"], "inline");
  });

  // A deliberate trade against the obvious one. Caching would save re-fetching
  // perhaps 100KB when HR reopens a record, at the cost of leaving a copy of
  // somebody's signature in the disk cache of a machine that may be shared.
  //
  // `private` alone keeps it out of proxies and still writes it to disk, which
  // is the part that matters — so the assertion is on `no-store` specifically.
  test("is never stored by the browser", () => {
    const res = makeRes();

    sendSignature(res, storedSignature());

    assert.match(res.headers["Cache-Control"], /no-store/);
  });
});
