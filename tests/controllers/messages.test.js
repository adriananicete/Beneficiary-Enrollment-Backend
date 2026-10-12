import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";
import { makeNext, makeReq, makeRes } from "../helpers/http.js";

const {
  conversationListItemOf,
  conversationOf,
  getConversation,
  markConversationRead,
  messageOf,
  openConversation,
  sendMessage,
} = await import("../../src/controllers/messageController.js");

// Messaging over REST. The scoping is in the procedures, read back
// 2026-10-12, and is proven by the manual run. What is tested here is what
// this side decides: what leaves, and what is refused before the database.

describe("what leaves, field by field", () => {
  test("a message carries its id, sender role, text and time, and not the sender's user id", () => {
    const shown = messageOf({
      message_id: "120",
      conversation_id: "7",
      sender_user_id: "12",
      sender_role: "Employee",
      body: "Hello",
      created_date: new Date(),
      client_id: "75",
      employer_id: "1",
    });

    assert.deepEqual(Object.keys(shown).sort(), ["body", "created_date", "message_id", "sender_role"]);
  });

  test("a conversation carries the named fields, and nothing a procedure adds later", () => {
    const shown = conversationOf({
      conversation_id: "7",
      client_id: "75",
      employer_id: "1",
      employee_name: "Ana Reyes",
      company_name: "Coforge",
      created_date: new Date(),
      last_message_id: "120",
      last_message_date: new Date(),
      employee_last_read_message_id: "118",
      hr_last_read_message_id: "120",
      can_send: true,
      started_by: "12",
      some_new_column: "x",
    });

    assert.equal("some_new_column" in shown, false);
    assert.equal("started_by" in shown, false);
    assert.equal(shown.can_send, true);
  });

  test("a list row carries the named fields, and not the paging total", () => {
    const shown = conversationListItemOf({
      conversation_id: "7",
      client_id: "75",
      employee_name: "Ana Reyes",
      last_message_date: new Date(),
      last_message_preview: "Hello",
      last_message_sender_role: "Employee",
      unread_count: 2,
      can_send: true,
      total_count: 1,
    });

    assert.equal("total_count" in shown, false);
    assert.equal(Object.keys(shown).length, 8);
  });
});

// getPool is never reached, so these run without a database.
describe("refused before the database", () => {
  const call = async (handler, req) => {
    const next = makeNext();
    await handler(makeReq({ user: { user_id: 12 }, params: { conversation_id: "7" }, ...req }), makeRes(), next);
    return next.refusal();
  };

  test("a blank message", async () => {
    assert.deepEqual(await call(sendMessage, { body: { body: "   " } }), { statusCode: 400, message: "A message cannot be empty" });
  });

  test("a message that is not text, or a request with no body at all", async () => {
    assert.equal((await call(sendMessage, { body: { body: 5 } }))?.statusCode, 400);
    assert.equal((await call(sendMessage, { body: undefined }))?.statusCode, 400);
  });

  test("a read marker that is not a message id", async () => {
    assert.deepEqual(await call(markConversationRead, { body: { last_read_message_id: "latest" } }), {
      statusCode: 400,
      message: "last_read_message_id must be a message id",
    });
  });

  test("HR opening a conversation without an employee", async () => {
    assert.deepEqual(await call(openConversation, { body: {} }), { statusCode: 400, message: "client_id is required" });
  });

  test("a history cursor that is not an id", async () => {
    assert.deepEqual(await call(getConversation, { query: { before: "yesterday" } }), {
      statusCode: 400,
      message: "before must be a message id",
    });
  });
});
