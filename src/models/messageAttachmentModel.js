import { sql } from "../config/db.js";

export const attachmentOf = row => ({
  attachment_id: String(row.attachment_id),
  file_name: row.file_name,
  mime_type: row.mime_type,
  byte_size: row.byte_size,
});
const insert = async (pool, { conversationId, messageId, file }) => {
  const result = await pool.request()
    .input("conversation_id", sql.BigInt, conversationId)
    .input("message_id", sql.BigInt, messageId)
    .input("file_name", sql.NVarChar(200), file.fileName)
    .input("mime_type", sql.VarChar(100), file.mimeType)
    .input("byte_size", sql.Int, file.byteSize)
    .input("sha256", sql.Char(64), file.sha256)
    .input("content", sql.VarBinary(sql.MAX), file.content)
    .execute("bes.usp_ins_message_attachment");
  return result.recordset[0];
};
// The controller has already verified access to the conversation through its SP.
const listMetadata = async (pool, conversationId, messageIds) => {
  if (!messageIds.length) return [];

  const result = await pool.request()
    .input("conversation_id", sql.BigInt, conversationId)
    .input(
      "message_ids_json",
      sql.NVarChar(sql.MAX),
      JSON.stringify(messageIds.map(id => String(id)))
    )
    .execute("bes.usp_sel_message_attachment_metadata");

  return result.recordset;
};
const get = async (pool, conversationId, attachmentId) => {
  const result = await pool.request()
    .input("conversation_id", sql.BigInt, conversationId)
    .input("attachment_id", sql.BigInt, attachmentId)
    .execute("bes.usp_sel_message_attachment");

  return result.recordset[0];
};
export default { insert, listMetadata, get };
