import { sql } from "../config/db.js";

// HR ↔ employee messaging, DBA request 22. Every procedure was read back on
// 2026-10-12 and is in md/DBA-PROCEDURES.md. None declares an OUTPUT
// parameter. usp_ins_conversation owns its short transaction. Attachment sends
// wrap usp_ins_message and usp_ins_message_attachment in an outer transaction,
// so the message and its file are committed or rolled back together.
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

// Save the message and file together. usp_ins_message has its own short
// transaction; SQL Server nests it inside this transaction, so an attachment
// insert failure still rolls back the message.
const insertMessageWithAttachment = async (pool, { conversationId, userId, body, attachment }) => {
  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    // usp_ins_message refuses an empty body (50174). For a file-only message,
    // use the uploaded name to pass that guard, save the attachment, then clear
    // the body in the same transaction so no placeholder reaches the history.
    const bodyToInsert = body || attachment.fileName || "Attachment";
    const messageResult = await transaction.request()
      .input("conversation_id", sql.BigInt, conversationId)
      .input("us01_user_id", sql.BigInt, userId)
      .input("body", sql.NVarChar(4000), bodyToInsert)
      .execute("bes.usp_ins_message");
    const message = messageResult.recordset[0];

    const attachmentResult = await transaction.request()
      .input("conversation_id", sql.BigInt, conversationId)
      .input("message_id", sql.BigInt, message.message_id)
      .input("file_name", sql.NVarChar(200), attachment.fileName)
      .input("mime_type", sql.VarChar(100), attachment.mimeType)
      .input("byte_size", sql.Int, attachment.byteSize)
      .input("sha256", sql.Char(64), attachment.sha256)
      .input("content", sql.VarBinary(sql.MAX), attachment.content)
      .execute("bes.usp_ins_message_attachment");

    if (!body) {
      const cleared = await transaction.request()
        .input("conversation_id", sql.BigInt, conversationId)
        .input("message_id", sql.BigInt, message.message_id)
        .query(`
          UPDATE bes.messages
          SET body = N''
          OUTPUT INSERTED.message_id
          WHERE conversation_id = @conversation_id
            AND message_id = @message_id;
        `);
      if (!cleared.recordset[0]) throw new Error("The attachment message could not be finalized");
      message.body = "";
    }

    await transaction.commit();
    return { ...message, ...attachmentResult.recordset[0] };
  } catch (error) {
    try { await transaction.rollback(); } catch { /* The procedure may already have rolled it back. */ }
    throw error;
  }
};

const getMessageAttachment = async (pool, conversationId, attachmentId) => {
  const result = await pool.request()
    .input("conversation_id", sql.BigInt, conversationId)
    .input("attachment_id", sql.BigInt, attachmentId)
    .execute("bes.usp_sel_message_attachment");
  return result.recordset[0];
};

const updateMessage = async (pool, { conversationId, messageId, userId, body }) => {
  const { conversation } = await getConversationById(pool, conversationId, userId, { limit: 1 });
  if (!conversation) return null;

  const result = await pool.request()
    .input("conversation_id", sql.BigInt, conversationId)
    .input("message_id", sql.BigInt, messageId)
    .input("us01_user_id", sql.BigInt, userId)
    .input("body", sql.NVarChar(4000), body)
    .query(`
      UPDATE bes.messages
      SET body = @body
      OUTPUT INSERTED.message_id, INSERTED.conversation_id, INSERTED.sender_role,
             INSERTED.body, INSERTED.created_date
      WHERE message_id = @message_id
        AND conversation_id = @conversation_id
        AND sender_user_id = @us01_user_id;
    `);

  const updated = result.recordset[0];
  return updated ? {
    ...updated,
    client_id: conversation.client_id,
    employer_id: conversation.employer_id,
  } : null;
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

const getMessageAttachmentMetadata = async (pool, conversationId, messageIds) => {
  if (!messageIds.length) return [];
  try {
    const result = await pool.request()
      .input("conversation_id", sql.BigInt, conversationId)
      .input("message_ids_json", sql.NVarChar(sql.MAX), JSON.stringify(messageIds.map(String)))
      .execute("bes.usp_sel_message_attachment_metadata");
    return result.recordset;
  } catch (error) {
    // Keep older database environments readable while the procedure rollout
    // is pending there.
    if (error.number === 2812) return [];
    throw error;
  }
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
  insertMessageWithAttachment,
  getMessageAttachment,
  updateMessage,
  getConversationsByUser,
  getConversationById,
  getMessageAttachmentMetadata,
  markConversationRead,
  getUnreadCountByUser,
};
