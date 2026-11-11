import { sql } from "../config/db.js";

// HR ↔ employee messaging, DBA request 22. Every procedure was read back on
// 2026-10-12 and is in md/DBA-PROCEDURES.md. None declares an OUTPUT
// parameter, and none is called inside a transaction of ours:
// usp_ins_conversation and usp_ins_message each own a short one.
//
// Every procedure scopes by the caller's own roles. An employee reaches only
// their own conversation; HR reaches those of the companies mapped to them; the
// Administrator reaches none (decided 2026-10-12).

// Opens the caller's conversation, creating it the first time. An employee
// passes no client id and gets their own, with their current company; HR
// passes the employee's. Returns { conversation_id, client_id, employer_id,
// created }.
const openConversation = async (pool, userId, clientId = null) => {
  const result = await pool
    .request()
    .input("us01_user_id", sql.BigInt, userId)
    .input("client_id", sql.BigInt, clientId)
    .execute("bes.usp_ins_conversation");

  return result.recordset[0];
};

// `body` is NVarChar(4000), wider than the column's 2000, so the procedure
// refuses an overlong message (50175) rather than the driver cutting it.
// Returns the saved message with the conversation's client_id and
// employer_id, which the socket branch will use to reach both sides.
const insertMessage = async (pool, { conversationId, userId, body }) => {
  const result = await pool
    .request()
    .input("conversation_id", sql.BigInt, conversationId)
    .input("us01_user_id", sql.BigInt, userId)
    .input("body", sql.NVarChar(4000), body)
    .execute("bes.usp_ins_message");

  return result.recordset[0];
};

// HR's list, unread first. `page_size` undefined reaches it as NULL, the
// whole set, as with the other HR lists.
const getConversationsByUser = async (pool, userId, paging = {}) => {
  const result = await pool
    .request()
    .input("us01_user_id", sql.BigInt, userId)
    .input("page", sql.Int, paging.page)
    .input("page_size", sql.Int, paging.pageSize)
    .execute("bes.usp_sel_conversations_by_user");

  return result.recordset;
};

// Three result sets, read by position:
//
//   [0] the conversation
//   [1] up to `limit` messages older than `before`, newest first
//   [2] has_more, whether older ones exist
//
// A conversation the caller may not see comes back empty rather than as a
// THROW, so `conversation` is null and the 404 is the caller's to make.
const getConversationById = async (pool, conversationId, userId, { before = null, limit = 50 } = {}) => {
  const result = await pool
    .request()
    .input("conversation_id", sql.BigInt, conversationId)
    .input("us01_user_id", sql.BigInt, userId)
    .input("before_message_id", sql.BigInt, before)
    .input("limit", sql.Int, limit)
    .execute("bes.usp_sel_conversation_by_id");

  const [header = [], messages = [], more = []] = result.recordsets ?? [];

  return {
    conversation: header[0] ?? null,
    messages,
    hasMore: Boolean(more[0]?.has_more),
  };
};

// Moves the caller's own read marker. Never backwards and never past the
// newest message; the procedure sees to both. "Not yours" is 50172.
const markConversationRead = async (pool, conversationId, userId, lastReadMessageId) => {
  await pool
    .request()
    .input("conversation_id", sql.BigInt, conversationId)
    .input("us01_user_id", sql.BigInt, userId)
    .input("last_read_message_id", sql.BigInt, lastReadMessageId)
    .execute("bes.usp_upd_conversation_read");
};

// For HR, conversations with something unread; for an employee, unread
// messages (both decided 2026-10-12).
const getUnreadCountByUser = async (pool, userId) => {
  const result = await pool
    .request()
    .input("us01_user_id", sql.BigInt, userId)
    .execute("bes.usp_sel_conversation_unread_count_by_user");

  return result.recordset[0]?.unread_count ?? 0;
};

export default {
  openConversation,
  insertMessage,
  getConversationsByUser,
  getConversationById,
  markConversationRead,
  getUnreadCountByUser,
};
