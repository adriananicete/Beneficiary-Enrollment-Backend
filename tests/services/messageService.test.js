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

const INSERT = "usp_ins_message";
const READ = "usp_upd_conversation_read";
const DETAIL = "usp_sel_conversation_by_id";

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

    assert.deepEqual(Object.keys(message).sort(), ["body", "conversation_id", "created_date", "message_id", "sender_role"]);
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
