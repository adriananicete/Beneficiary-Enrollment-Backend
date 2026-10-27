import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";

import { parseDocuments } from "../../src/middlewares/parseDocuments.js";
import { errorHandler } from "../../src/middlewares/errorHandler.js";
import { silenceConsoleError } from "../helpers/http.js";

// Through a real Express app and real multipart requests, so this tests what
// multer actually does rather than a shape assumed for it. A fake request
// would not have shown that busboy reads file names as latin1: measured
// 2026-10-06, "Peña ID.jpg" arrived as "PeÃ±a ID.jpg" until it was told
// otherwise.

let server;
let base;
let restoreConsole;

before(() => {
  restoreConsole = silenceConsoleError();

  const app = express();
  app.use(express.json());
  app.post("/upload", parseDocuments, (req, res) =>
    res.status(200).json({
      body: req.body,
      documents: req.documents.map(({ content, ...described }) => ({
        ...described,
        isBuffer: Buffer.isBuffer(content),
        length: content.length,
      })),
    }),
  );
  app.use(errorHandler);

  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  restoreConsole();
});

const FIVE_MB = 5 * 1024 * 1024;

const pdf = (size = 64) => {
  const buffer = Buffer.alloc(size, 0x20);
  Buffer.from("%PDF-1.7").copy(buffer);
  return buffer;
};

const jpeg = () => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

const post = async (form) => {
  const response = await fetch(`${base}/upload`, { method: "POST", body: form });
  return { status: response.status, body: await response.json() };
};

describe("parseDocuments", () => {
  test("files come out typed from their bytes, with their field, and text fields on req.body", async () => {
    const form = new FormData();
    form.append("requirement_1", new Blob([pdf()]), "death certificate.pdf");
    form.append("requirement_2", new Blob([jpeg()]), "valid id.jpg");
    form.append("remarks", "filed by HR");

    const { status, body } = await post(form);

    assert.equal(status, 200);
    assert.deepEqual(body.body, { remarks: "filed by HR" });
    assert.deepEqual(
      body.documents.map(({ field, fileName, mimeType, byteSize, isBuffer }) => ({
        field, fileName, mimeType, byteSize, isBuffer,
      })),
      [
        { field: "requirement_1", fileName: "death certificate.pdf", mimeType: "application/pdf", byteSize: 64, isBuffer: true },
        { field: "requirement_2", fileName: "valid id.jpg", mimeType: "image/jpeg", byteSize: 6, isBuffer: true },
      ],
    );
    assert.match(body.documents[0].sha256, /^[0-9a-f]{64}$/);
  });

  // Filipino names carry ñ.
  test("a non-ASCII file name arrives intact", async () => {
    const form = new FormData();
    form.append("requirement_1", new Blob([jpeg()]), "Peña ID.jpg");

    const { body } = await post(form);

    assert.equal(body.documents[0].fileName, "Peña ID.jpg");
  });

  test("a path in the file name is reduced to its last segment", async () => {
    const form = new FormData();
    form.append("requirement_1", new Blob([pdf()]), "C:\\fakepath\\cert.pdf");

    const { body } = await post(form);

    assert.equal(body.documents[0].fileName, "cert.pdf");
  });

  test("exactly 5MB is accepted", async () => {
    const form = new FormData();
    form.append("requirement_1", new Blob([pdf(FIVE_MB)]), "exact.pdf");

    const { status, body } = await post(form);

    assert.equal(status, 200);
    assert.equal(body.documents[0].byteSize, FIVE_MB);
  });

  // multer's own error has no status; errorHandler would answer it as 500.
  test("5MB and one byte is 413", async () => {
    const form = new FormData();
    form.append("requirement_1", new Blob([pdf(FIVE_MB + 1)]), "big.pdf");

    const { status, body } = await post(form);

    assert.equal(status, 413);
    assert.equal(body.message, "Each document must be 5MB or smaller");
  });

  test("eleven files is 400", async () => {
    const form = new FormData();
    for (let i = 0; i < 11; i++) form.append(`requirement_${i}`, new Blob([pdf()]), `${i}.pdf`);

    const { status, body } = await post(form);

    assert.equal(status, 400);
    assert.equal(body.message, "No more than 10 documents can be uploaded at once");
  });

  // The name says PDF; the bytes say otherwise. The bytes win, and the
  // refusal names the file so the uploader knows which one to replace.
  test("a file that is not what its name says is refused, by name", async () => {
    const form = new FormData();
    form.append("requirement_1", new Blob([pdf()]), "good.pdf");
    form.append("requirement_2", new Blob(["<html><script>alert(1)</script>"]), "fake.pdf");

    const { status, body } = await post(form);

    assert.equal(status, 400);
    assert.equal(body.message, "fake.pdf: Documents must be PDF, JPG or PNG");
  });

  test("a request that is not multipart carries no documents and keeps its JSON body", async () => {
    const response = await fetch(`${base}/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x: 1 }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { body: { x: 1 }, documents: [] });
  });
});
