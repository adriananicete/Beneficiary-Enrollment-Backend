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
    .query(`INSERT INTO dbo.bes_message_attachments
      (conversation_id, message_id, file_name, mime_type, byte_size, sha256, content)
      OUTPUT INSERTED.attachment_id, INSERTED.file_name, INSERTED.mime_type, INSERTED.byte_size
      VALUES (@conversation_id, @message_id, @file_name, @mime_type, @byte_size, @sha256, @content)`);
  return result.recordset[0];
};
// The controller has already verified access to the conversation through its SP.
const listMetadata = async (pool, conversationId, messageIds) => {
  if (!messageIds.length) return [];
  const request = pool.request().input("conversation_id", sql.BigInt, conversationId);
  const params = messageIds.map((id,index) => {request.input(`message_${index}`, sql.BigInt, id);return `@message_${index}`;});
  const result = await request.query(`SELECT attachment_id, message_id, file_name, mime_type, byte_size
    FROM dbo.bes_message_attachments WHERE conversation_id = @conversation_id
    AND message_id IN (${params.join(",")}) ORDER BY attachment_id`);
  return result.recordset;
};
const get = async (pool, conversationId, attachmentId) => {
  const result = await pool.request()
    .input("conversation_id", sql.BigInt, conversationId)
    .input("attachment_id", sql.BigInt, attachmentId)
    .query(`SELECT file_name, mime_type, byte_size, content FROM dbo.bes_message_attachments
      WHERE conversation_id = @conversation_id AND attachment_id = @attachment_id`);
  return result.recordset[0];
};
export default { insert, listMetadata, get };
