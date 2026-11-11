import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";

import "../helpers/env.js";
import { silenceConsoleError } from "../helpers/http.js";

const {
  ATTACHMENT_REQUIRED,
  ATTACHMENT_TOO_LARGE,
  ONE_ATTACHMENT,
  parseAttachmentUpload,
  parseMessageAttachment,
} = await import("../../src/middlewares/parseMessageAttachment.js");
const { errorHandler } = await import("../../src/middlewares/errorHandler.js");
const { messageTextOf } = await import("../../src/controllers/messageController.js");

// A file sent with a message, DBA request 29. Through a real Express app and
// real multipart requests, as parseDocuments is tested, because what multer
// does is the thing being tested.

let server;
let base;
let restoreConsole;

before(() => {
  restoreConsole = silenceConsoleError();

  const show = (req, res) =>
    res.status(200).json({
      body: req.body,
      attachment: req.attachment && {
        ...req.attachment,
        content: undefined,
        isBuffer: Buffer.isBuffer(req.attachment.content),
        length: req.attachment.content.length,
      },
    });

  const app = express();
  app.use(express.json());
  app.post("/messages", parseMessageAttachment, show);
  app.post("/attachments", parseAttachmentUpload, show);
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

const png = () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

const post = async (path, body, headers) => {
  const response = await fetch(`${base}${path}`, { method: "POST", body, headers });
  return { status: response.status, body: await response.json() };
};

const form = (entries) => {
  const data = new FormData();
  // A text field takes two arguments; a third, even undefined, makes it a file.
  for (const [field, value, name] of entries)
    if (name === undefined) data.append(field, value);
    else data.append(field, new Blob([value]), name);
  return data;
};

describe("parseMessageAttachment, on POST …/messages", () => {
  test("a JSON text message passes through untouched, with no attachment", async () => {
    const { status, body } = await post("/messages", JSON.stringify({ body: "Hello" }), { "content-type": "application/json" });

    assert.equal(status, 200);
    assert.deepEqual(body, { body: { body: "Hello" }, attachment: null });
  });

  test("a file and its text: the file typed from its bytes, the text on req.body", async () => {
    const { status, body } = await post("/messages", form([["body", "My payslip"], ["attachment", pdf(), "payslip.pdf"]]));

    assert.equal(status, 200);
    assert.deepEqual(body.body, { body: "My payslip" });
    assert.equal(body.attachment.fileName, "payslip.pdf");
    assert.equal(body.attachment.mimeType, "application/pdf");
    assert.equal(body.attachment.byteSize, 64);
    assert.match(body.attachment.sha256, /^[0-9a-f]{64}$/);
    assert.equal(body.attachment.isBuffer, true);
  });

  test("the type comes from the bytes, not the name", async () => {
    const { status, body } = await post("/messages", form([["attachment", png(), "looks like.pdf"]]));

    assert.equal(status, 200);
    assert.equal(body.attachment.mimeType, "image/png");
  });

  test("multipart with text only is a text message", async () => {
    const { status, body } = await post("/messages", form([["body", "Hello"]]));

    assert.equal(status, 200);
    assert.deepEqual(body, { body: { body: "Hello" }, attachment: null });
  });

  test("a file that is not PDF, JPG or PNG is 400, named, and says attachment", async () => {
    const { status, body } = await post("/messages", form([["attachment", Buffer.from("MZ not a document"), "setup.exe"]]));

    assert.equal(status, 400);
    assert.equal(body.message, "setup.exe: Attachments must be PDF, JPG or PNG");
  });

  test("an empty file is 400", async () => {
    const { status, body } = await post("/messages", form([["attachment", Buffer.alloc(0), "empty.pdf"]]));

    assert.equal(status, 400);
    assert.equal(body.message, "empty.pdf: The attachment is empty");
  });

  test("over 5MB is 413", async () => {
    const { status, body } = await post("/messages", form([["attachment", pdf(FIVE_MB + 1), "big.pdf"]]));

    assert.equal(status, 413);
    assert.equal(body.message, ATTACHMENT_TOO_LARGE);
  });

  test("exactly 5MB is accepted", async () => {
    const { status } = await post("/messages", form([["attachment", pdf(FIVE_MB), "edge.pdf"]]));

    assert.equal(status, 200);
  });

  test("two files, or a file under another field name, are 400", async () => {
    for (const entries of [
      [["attachment", pdf(), "one.pdf"], ["attachment", pdf(), "two.pdf"]],
      [["file", pdf(), "wrong field.pdf"]],
    ]) {
      const { status, body } = await post("/messages", form(entries));

      assert.equal(status, 400, JSON.stringify(entries.map(([field, , name]) => [field, name])));
      assert.equal(body.message, ONE_ATTACHMENT);
    }
  });

  test("the file name is cleaned: the last path segment, ñ read as UTF-8", async () => {
    const { body } = await post("/messages", form([["attachment", pdf(), "C:\\fakepath\\Peña ID.pdf"]]));

    assert.equal(body.attachment.fileName, "Peña ID.pdf");
  });

  // busboy already drops a path, so this is what cleanFileName adds here: a
  // name is cut to 200 characters, which is the column, and it becomes the
  // message's text when there is no other.
  test("a name over 200 characters is cut to 200", async () => {
    const { body } = await post("/messages", form([["attachment", pdf(), `${"x".repeat(250)}.pdf`]]));

    assert.equal(body.attachment.fileName.length, 200);
  });
});

describe("parseAttachmentUpload, on POST …/attachments", () => {
  test("the file is `file`, with an optional caption", async () => {
    const { status, body } = await post("/attachments", form([["body", "Caption"], ["file", pdf(), "id.pdf"]]));

    assert.equal(status, 200);
    assert.equal(body.attachment.fileName, "id.pdf");
    assert.deepEqual(body.body, { body: "Caption" });
  });

  test("no file is 400: this route is for a file", async () => {
    for (const payload of [form([["body", "Caption"]]), JSON.stringify({ body: "Caption" })]) {
      const headers = typeof payload === "string" ? { "content-type": "application/json" } : undefined;
      const { status, body } = await post("/attachments", payload, headers);

      assert.equal(status, 400);
      assert.equal(body.message, ATTACHMENT_REQUIRED);
    }
  });
});

describe("messageTextOf: the text a message is saved with", () => {
  const FILE = { fileName: "payslip.pdf" };

  test("a file with no text carries the file's name", () => {
    for (const body of [undefined, "", "   \n "]) assert.equal(messageTextOf(body, FILE), "payslip.pdf", JSON.stringify(body));
  });

  test("a file with text keeps the text, trimmed", () => {
    assert.equal(messageTextOf("  My payslip  ", FILE), "My payslip");
  });

  test("text with a file is still held to the rules", () => {
    assert.throws(() => messageTextOf("x".repeat(2001), FILE), { statusCode: 400 });
    assert.throws(() => messageTextOf(42, FILE), { statusCode: 400 });
  });

  test("with no file, a message still needs its text", () => {
    for (const body of [undefined, "", "  "]) assert.throws(() => messageTextOf(body, null), { statusCode: 400 }, JSON.stringify(body));
    assert.equal(messageTextOf(" Hello ", null), "Hello");
  });
});

describe("sendMessage, the controller", async () => {
  const { createSendMessage } = await import("../../src/controllers/messageController.js");
  const { makeNext, makeReq, makeRes } = await import("../helpers/http.js");

  const sent = async (req) => {
    const calls = [];
    const res = makeRes();
    const next = makeNext();

    await createSendMessage({
      poolOf: async () => "pool",
      send: async (pool, input) => (calls.push({ pool, input }), { message_id: "1" }),
    })(makeReq({ params: { conversation_id: "7" }, user: { user_id: 12 }, ...req }), res, next);

    return { calls, res, next };
  };

  test("a file is handed to the service with the message, its name as the text", async () => {
    const attachment = { fileName: "payslip.pdf", content: Buffer.from("x"), mimeType: "application/pdf", byteSize: 1, sha256: "a".repeat(64) };
    const { calls, res } = await sent({ attachment, body: {} });

    assert.equal(res.statusCode, 201);
    assert.deepEqual(calls, [{ pool: "pool", input: { conversationId: "7", userId: 12, body: "payslip.pdf", attachment } }]);
  });

  test("a text message is handed over with no attachment", async () => {
    const { calls } = await sent({ body: { body: "Hello" } });

    assert.deepEqual(calls[0].input, { conversationId: "7", userId: 12, body: "Hello", attachment: null });
  });

  test("a refused text never reaches the service", async () => {
    const { calls, next } = await sent({ body: { body: "  " } });

    assert.equal(calls.length, 0);
    assert.equal(next.refusal()?.statusCode, 400);
  });
});