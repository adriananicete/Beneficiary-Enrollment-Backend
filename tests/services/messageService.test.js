import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";
import { callTo, fakePool, inputsFor } from "../helpers/fakePool.js";
import { fakeIo } from "../helpers/fakeIo.js";
import { silenceConsoleError } from "../helpers/http.js";

const { default: MessageService } = await import("../../src/services/messageService.js");
const { setRealtimeServer } = await import("../../src/realtime/realtime.js");

// Sending and reading: REST does the work, then the socket says it happened.
// What is tested is that the announcement reaches both sides with the right
// payload, and that it can never fail the call.

const INSERT = "bes.usp_ins_message";
const READ = "bes.usp_upd_conversation_read";
const DETAIL = "bes.usp_sel_conversation_by_id";

const SAVED = {
  message_id: "120",
  conversation_id: "7",
  client_id: "75",
  employer_id: "1",
  sender_role: "Employee",
  body: "Hello",
  created_date: new Date("2026-10-12T02:00:00Z"),
};

const HEADER = {
  conversation_id: "7",
  client_id: "75",
  employer_id: "1",
  employee_last_read_message_id: "118",
  hr_last_read_message_id: "120",
};

let restoreConsole = () => {};

afterEach(() => {
  setRealtimeServer(null);
  restoreConsole();
  restoreConsole = () => {};
});

describe("messageService.sendMessage", () => {
  test("saves, then announces message:new to the employee's room and the company's HR room", async () => {
    const { io, events } = fakeIo();
    setRealtimeServer(io);
    const { pool, calls } = fakePool({ [INSERT]: [SAVED] });

    const message = await MessageService.sendMessage(pool, { conversationId: "7", userId: 12, body: "Hello" });

    assert.deepEqual(inputsFor(calls, INSERT), { conversation_id: "7", us01_user_id: 12, body: "Hello" });
    assert.deepEqual(events, [
      { kind: "emit", rooms: ["client:75", "hr:1"], event: "message:new", payload: message },
    ]);
  });

  // The same shape over REST and over the socket, and never who on the shared
  // HR account wrote it.
  test("the message carries its conversation, id, sender role, text and time, and no user id or rooms", async () => {
    const { pool } = fakePool({ [INSERT]: [{ ...SAVED, sender_user_id: "3" }] });

    const message = await MessageService.sendMessage(pool, { conversationId: "7", userId: 12, body: "Hello" });

    assert.deepEqual(Object.keys(message).sort(), ["attachments", "body", "conversation_id", "created_date", "edited_date", "message_id", "sender_role"]);
    assert.deepEqual(message.attachments, []);
    assert.equal(message.edited_date, null, "a new message has never been edited");
  });

  test("a failed save announces nothing", async () => {
    const { io, events } = fakeIo();
    setRealtimeServer(io);
    const { pool } = fakePool({
      [INSERT]: () => {
        throw Object.assign(new Error("closed"), { number: 50173 });
      },
    });

    await assert.rejects(MessageService.sendMessage(pool, { conversationId: "7", userId: 12, body: "Hello" }));
    assert.deepEqual(events, []);
  });
});

describe("messageService.markRead", () => {
  // The procedure may not move the marker as far as asked, so the markers
  // announced are read back, not assumed.
  test("moves the marker, then announces where both markers now stand", async () => {
    const { io, events } = fakeIo();
    setRealtimeServer(io);
    const { pool, calls } = fakePool({
      [READ]: [],
      [DETAIL]: () => ({ recordsets: [[HEADER], [], [{ has_more: false }]] }),
    });

    await MessageService.markRead(pool, { conversationId: "7", userId: 3, lastReadMessageId: "999" });

    assert.equal(inputsFor(calls, READ).last_read_message_id, "999");
    assert.deepEqual(events, [
      {
        kind: "emit",
        rooms: ["client:75", "hr:1"],
        event: "conversation:read",
        payload: { conversation_id: "7", employee_last_read_message_id: "118", hr_last_read_message_id: "120" },
      },
    ]);
  });

  test("with no socket server, the conversation is not read back at all", async () => {
    const { pool, calls } = fakePool({ [READ]: [] });

    await MessageService.markRead(pool, { conversationId: "7", userId: 3, lastReadMessageId: "120" });

    assert.equal(callTo(calls, DETAIL), undefined);
  });

  test("a failed read-back is logged, and the call still succeeds", async () => {
    restoreConsole = silenceConsoleError();
    const { io, events } = fakeIo();
    setRealtimeServer(io);
    const { pool } = fakePool({
      [READ]: [],
      [DETAIL]: () => {
        throw new Error("timeout");
      },
    });

    await assert.doesNotReject(MessageService.markRead(pool, { conversationId: "7", userId: 3, lastReadMessageId: "120" }));
    assert.deepEqual(events, []);
  });
});

// Files on messages, 2026-11-11, the reading half. The metadata comes in one
// call for the page; the file itself only after the conversation is read as
// the caller's, because the procedure that hands it over takes no user id.
const METADATA = "bes.usp_sel_message_attachment_metadata";
const FILE = "bes.usp_sel_message_attachment";

const message = (id, body = "Hello") => ({ message_id: id, sender_role: "HR", body, created_date: new Date("2026-11-11T01:00:00Z") });

describe("messageService.getConversation", () => {
  const read = ({ messages = [message("120"), message("121")], files = [] } = {}) => {
    const { pool, calls } = fakePool({
      [DETAIL]: () => ({ recordsets: [[HEADER], messages, [{ has_more: true }]] }),
      [METADATA]: files,
    });

    return { calls, result: MessageService.getConversation(pool, "7", 3, { before: null, limit: 50 }) };
  };

  test("each message carries its own files, and an empty list when it has none", async () => {
    const { result } = read({
      files: [
        { attachment_id: "9", message_id: "121", file_name: "id.png", mime_type: "image/png", byte_size: 2048 },
        { attachment_id: "10", message_id: "121", file_name: "b.pdf", mime_type: "application/pdf", byte_size: 10 },
      ],
    });

    const { conversation, messages, hasMore } = await result;

    assert.equal(conversation.conversation_id, "7");
    assert.equal(hasMore, true);
    assert.deepEqual(messages[0].attachments, []);
    assert.deepEqual(messages[1].attachments, [
      { attachment_id: "9", file_name: "id.png", mime_type: "image/png", byte_size: 2048 },
      { attachment_id: "10", file_name: "b.pdf", mime_type: "application/pdf", byte_size: 10 },
    ]);
  });

  // One call for the page, with the ids as the JSON array of strings the
  // procedure insists on (51102, 51103).
  test("the files are asked for once, for the page's messages, as strings", async () => {
    const { calls, result } = read();
    await result;

    const asked = calls.filter((call) => call.procedure === METADATA);

    assert.equal(asked.length, 1);
    assert.equal(asked[0].inputs.conversation_id, "7");
    assert.equal(asked[0].inputs.message_ids_json, '["120","121"]');
  });

  test("a page with no messages asks for no files", async () => {
    const { calls, result } = read({ messages: [] });
    await result;

    assert.equal(callTo(calls, METADATA), undefined);
  });

  // Not theirs, or not there: the procedure answers both the same way.
  test("a conversation the caller cannot see is null, and no files are asked for", async () => {
    const { pool, calls } = fakePool({ [DETAIL]: () => ({ recordsets: [[], [], []] }), [METADATA]: [] });

    assert.equal(await MessageService.getConversation(pool, "7", 3, {}), null);
    assert.equal(callTo(calls, METADATA), undefined);
  });
});

describe("messageService.getAttachment", () => {
  const PDF = Buffer.from("%PDF-1.7 the bytes");

  const fetch = ({ conversation = HEADER, file = { file_name: "letter.pdf", mime_type: "application/pdf", byte_size: PDF.length, content: PDF } } = {}) => {
    const { pool, calls } = fakePool({
      [DETAIL]: () => ({ recordsets: [conversation ? [conversation] : [], [], []] }),
      [FILE]: file ? [file] : [],
    });

    return { calls, result: MessageService.getAttachment(pool, "7", "9", 3) };
  };

  test("answers the file, its type, its real length and a clean name", async () => {
    const { calls, result } = fetch();

    assert.deepEqual(await result, { content: PDF, mimeType: "application/pdf", byteSize: PDF.length, fileName: "letter.pdf" });
    assert.equal(inputsFor(calls, DETAIL).us01_user_id, 3);
    assert.equal(inputsFor(calls, FILE).attachment_id, "9");
  });

  // The procedure that hands the file over takes no user id. Another
  // employee's or company's conversation must stop before it is asked.
  test("a conversation the caller cannot see is 404, and the file is never asked for", async () => {
    const { calls, result } = fetch({ conversation: null });

    await assert.rejects(() => result, (error) => error.statusCode === 404 && error.message === "Conversation not found");
    assert.equal(callTo(calls, FILE), undefined);
  });

  test("a file that is not in this conversation is 404", async () => {
    await assert.rejects(() => fetch({ file: null }).result, (error) => error.statusCode === 404 && error.message === "Attachment not found");
  });

  // Sent files are PDF, JPG or PNG, read from their bytes. A stored type that
  // is none of these goes out as a plain download, not as what it claims.
  test("a stored type outside PDF, JPG and PNG goes out as octet-stream", async () => {
    for (const mime_type of ["text/html", "image/svg+xml", "application/javascript", null]) {
      const { result } = fetch({ file: { file_name: "x", mime_type, byte_size: 3, content: Buffer.from("abc") } });

      assert.equal((await result).mimeType, "application/octet-stream", String(mime_type));
    }
  });

  test("a name with a path in it keeps only its last part", async () => {
    const { result } = fetch({ file: { file_name: "..\\..\\evil.pdf", mime_type: "application/pdf", byte_size: PDF.length, content: PDF } });

    assert.equal((await result).fileName, "evil.pdf");
  });
});

// DBA request 29: a message and its file, in one procedure with its own
// transaction. The text-only path keeps usp_ins_message.
describe("messageService.sendMessage, with a file", () => {
  const WITH_FILE = "bes.usp_ins_message_with_attachment";
  const CONTENT = Buffer.from("%PDF-1.7 a small one");
  const ATTACHMENT = {
    fileName: "payslip.pdf",
    content: CONTENT,
    mimeType: "application/pdf",
    byteSize: CONTENT.length,
    sha256: "a".repeat(64),
  };
  const SAVED_WITH_FILE = {
    ...SAVED,
    body: "payslip.pdf",
    attachment_id: "31",
    file_name: "payslip.pdf",
    mime_type: "application/pdf",
    byte_size: CONTENT.length,
  };

  test("one call to the procedure that saves both, with every field of the file", async () => {
    const { pool, calls } = fakePool({ [WITH_FILE]: [SAVED_WITH_FILE] });

    await MessageService.sendMessage(pool, { conversationId: "7", userId: 12, body: "payslip.pdf", attachment: ATTACHMENT });

    assert.equal(callTo(calls, INSERT), undefined, "the text-only procedure was called too");
    assert.deepEqual(inputsFor(calls, WITH_FILE), {
      conversation_id: "7",
      us01_user_id: 12,
      body: "payslip.pdf",
      file_name: "payslip.pdf",
      mime_type: "application/pdf",
      byte_size: CONTENT.length,
      sha256: "a".repeat(64),
      content: CONTENT,
    });
  });

  test("the message answered and announced lists its file, without the content", async () => {
    const { io, events } = fakeIo();
    setRealtimeServer(io);
    const { pool } = fakePool({ [WITH_FILE]: [SAVED_WITH_FILE] });

    const message = await MessageService.sendMessage(pool, { conversationId: "7", userId: 12, body: "payslip.pdf", attachment: ATTACHMENT });

    assert.deepEqual(message.attachments, [
      { attachment_id: "31", file_name: "payslip.pdf", mime_type: "application/pdf", byte_size: CONTENT.length },
    ]);
    assert.deepEqual(events, [{ kind: "emit", rooms: ["client:75", "hr:1"], event: "message:new", payload: message }]);
  });

  test("with no file, the text-only procedure as before, and no attachments", async () => {
    const { pool, calls } = fakePool({ [INSERT]: [SAVED] });

    const message = await MessageService.sendMessage(pool, { conversationId: "7", userId: 12, body: "Hello", attachment: null });

    assert.equal(callTo(calls, WITH_FILE), undefined);
    assert.deepEqual(message.attachments, []);
  });
});
const { default: MessageModel } = await import("../../src/models/messageModel.js");
const { declarationOf } = await import("../helpers/fakePool.js");

// The binding of the file, DBA request 29: the content whole, the hash as 64
// characters, the name as Unicode.
describe("MessageModel.insertMessageWithAttachment", () => {
  test("binds each field as the procedure declares it", async () => {
    const { pool, calls } = fakePool({ "bes.usp_ins_message_with_attachment": [{}] });

    await MessageModel.insertMessageWithAttachment(pool, {
      conversationId: "7",
      userId: 12,
      body: "Peña ID.pdf",
      fileName: "Peña ID.pdf",
      mimeType: "application/pdf",
      byteSize: 3,
      sha256: "a".repeat(64),
      content: Buffer.from("abc"),
    });

    const { bindings, outputs } = callTo(calls, "bes.usp_ins_message_with_attachment");
    const expected = {
      conversation_id: ["bigint"],
      us01_user_id: ["bigint"],
      body: ["nvarchar", 4000],
      file_name: ["nvarchar", 200],
      mime_type: ["varchar", 100],
      byte_size: ["int"],
      sha256: ["char", 64],
    };

    for (const [name, [declaration, length]] of Object.entries(expected)) {
      assert.equal(declarationOf(bindings[name].type), declaration, name);
      if (length !== undefined) assert.equal(bindings[name].type.length, length, name);
    }

    assert.equal(declarationOf(bindings.content.type), "varbinary");
    assert.ok(bindings.content.type.length > 8000, "content must be VARBINARY(MAX), not cut at 8000 bytes");
    assert.deepEqual(outputs, {}, "no OUTPUT parameter");
  });
});
const { messageOf } = await import("../../src/services/messageService.js");

// DBA request 30: the sender corrects their own message within 15 minutes.
describe("messageService.editMessage", () => {
  const UPDATE = "bes.usp_upd_message";
  const EDITED = {
    message_id: "120",
    conversation_id: "7",
    client_id: "75",
    employer_id: "1",
    sender_role: "Employee",
    body: "Hello, corrected",
    created_date: new Date("2026-10-12T02:00:00Z"),
    edited_date: new Date("2026-10-12T02:05:00Z"),
  };

  test("one call to the procedure, with the message, the caller and the text", async () => {
    const { pool, calls } = fakePool({ [UPDATE]: [EDITED] });

    await MessageService.editMessage(pool, { conversationId: "7", messageId: "120", userId: 12, body: "Hello, corrected" });

    assert.deepEqual(inputsFor(calls, UPDATE), {
      conversation_id: "7",
      message_id: "120",
      us01_user_id: 12,
      body: "Hello, corrected",
    });
  });

  test("answers and announces message:updated to both sides, with what changed and no attachments list", async () => {
    const { io, events } = fakeIo();
    setRealtimeServer(io);
    const { pool } = fakePool({ [UPDATE]: [EDITED] });

    const message = await MessageService.editMessage(pool, { conversationId: "7", messageId: "120", userId: 12, body: "Hello, corrected" });

    assert.deepEqual(message, {
      conversation_id: "7",
      message_id: "120",
      sender_role: "Employee",
      body: "Hello, corrected",
      created_date: EDITED.created_date,
      edited_date: EDITED.edited_date,
    });
    assert.deepEqual(events, [{ kind: "emit", rooms: ["client:75", "hr:1"], event: "message:updated", payload: message }]);
  });

  test("a refused edit (not theirs, too late, read-only) announces nothing", async () => {
    for (const number of [50225, 50226, 50173]) {
      const { io, events } = fakeIo();
      setRealtimeServer(io);
      const { pool } = fakePool({
        [UPDATE]: () => {
          throw Object.assign(new Error("refused"), { number });
        },
      });

      await assert.rejects(MessageService.editMessage(pool, { conversationId: "7", messageId: "120", userId: 12, body: "x" }));
      assert.deepEqual(events, [], String(number));
    }
  });

  test("the model binds the text as NVARCHAR(4000), wider than the column, so the procedure refuses an overlong one", async () => {
    const { pool, calls } = fakePool({ [UPDATE]: [EDITED] });
    await MessageModel.updateMessage(pool, { conversationId: "7", messageId: "120", userId: 12, body: "x" });

    const { bindings, outputs } = callTo(calls, UPDATE);
    assert.equal(declarationOf(bindings.body.type), "nvarchar");
    assert.equal(bindings.body.type.length, 4000);
    assert.equal(declarationOf(bindings.message_id.type), "bigint");
    assert.deepEqual(outputs, {});
  });

  test("the conversation view shows when a message was edited", () => {
    assert.equal(messageOf({ ...EDITED }).edited_date, EDITED.edited_date);
  });
});

describe("the edit's error numbers", async () => {
  const { sqlErrorMap } = await import("../../src/utils/sqlErrorMap.js");

  test("50225, not the caller's or not there, is 404; 50226, too late, is 409", () => {
    assert.equal(sqlErrorMap[50225].statusCode, 404);
    assert.equal(sqlErrorMap[50226].statusCode, 409);
    assert.match(sqlErrorMap[50226].message, /15 minutes/);
  });
});