import MessageModel from "../models/messageModel.js";
import { emitToConversation, realtimeIsOn } from "../realtime/realtime.js";
import { AppError } from "../utils/AppError.js";
import { cleanFileName } from "../utils/validateDocument.js";

// Sending and reading, and announcing both to the screens that are open.
// Branch 9: REST does the work, then the socket says it happened. Takes the
// pool, like every service since PR #102, so a test can hand it a fake.
//
// An announcement never fails the call. emitToConversation swallows its own
// errors, and the read lookup below does too: the message is saved and the
// marker moved whether or not anybody hears about it.

// The message as it leaves, over REST and over the socket alike. Its files,
// one at most today, are listed by their metadata; the content is fetched
// on its own (getAttachment).
export const messageOf = (row, attachments = []) => ({
  message_id: row.message_id,
  sender_role: row.sender_role,
  body: row.body,
  created_date: row.created_date,
  attachments,
});

// A file as a message lists it.
export const attachmentOf = (row) => ({
  attachment_id: row.attachment_id,
  file_name: row.file_name,
  mime_type: row.mime_type,
  byte_size: row.byte_size,
});

// A conversation the caller may see, with a page of its messages and each
// message's files. null when it is not theirs, or does not exist: the
// procedure answers both the same way, and so does the 404 made of it.
//
// The files are read in one call for the whole page, not one per message.
const getConversation = async (pool, conversationId, userId, cursor) => {
  const { conversation, messages, hasMore } = await MessageModel.getConversationById(pool, conversationId, userId, cursor);

  if (!conversation) return null;

  const files = messages.length
    ? await MessageModel.getAttachmentMetadata(pool, conversationId, messages.map((message) => message.message_id))
    : [];

  const byMessage = new Map();
  for (const file of files) {
    const key = String(file.message_id);
    byMessage.set(key, [...(byMessage.get(key) ?? []), attachmentOf(file)]);
  }

  return {
    conversation,
    messages: messages.map((message) => messageOf(message, byMessage.get(String(message.message_id)) ?? [])),
    hasMore,
  };
};

// The three types a message's file may be, read from its bytes when it was
// sent. A stored type that is not one of them goes out as a plain download
// rather than as whatever it claims to be.
const SAFE_TYPES = ["application/pdf", "image/jpeg", "image/png"];

// One file, for downloading. bes.usp_sel_message_attachment takes no user id,
// so the conversation is read first, as the caller: another employee's, or
// another company's, is 404 before the file is even asked for. A file that is
// not in that conversation is 404 too.
const getAttachment = async (pool, conversationId, attachmentId, userId) => {
  const { conversation } = await MessageModel.getConversationById(pool, conversationId, userId, { limit: 1 });
  if (!conversation) throw new AppError("Conversation not found", 404);

  const file = await MessageModel.getAttachment(pool, conversationId, attachmentId);
  if (!file) throw new AppError("Attachment not found", 404);

  return {
    content: file.content,
    mimeType: SAFE_TYPES.includes(file.mime_type) ? file.mime_type : "application/octet-stream",
    byteSize: file.content.length,
    fileName: cleanFileName(file.file_name),
  };
};

// `body` has already been through messageBodyOf. `attachment` is the file
// parseMessageAttachment read, or null. With one, the message and the file are
// saved together by one procedure in its own transaction (DBA request 29), so
// a file that fails a check leaves no message behind. The teammates nested
// usp_ins_message inside a transaction of theirs instead, the CLAUDE.md §5
// trap, so that is not ported.
const sendMessage = async (pool, { conversationId, userId, body, attachment = null }) => {
  const saved = attachment
    ? await MessageModel.insertMessageWithAttachment(pool, {
        conversationId,
        userId,
        body,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        byteSize: attachment.byteSize,
        sha256: attachment.sha256,
        content: attachment.content,
      })
    : await MessageModel.insertMessage(pool, { conversationId, userId, body });

  const message = {
    conversation_id: saved.conversation_id,
    ...messageOf(saved, attachment ? [attachmentOf(saved)] : []),
  };

  // To both sides. The procedure returns the conversation's client and
  // company for exactly this.
  emitToConversation(
    { clientId: saved.client_id, employerId: saved.employer_id },
    "message:new",
    message,
  );

  return message;
};

// Moves the caller's read marker, then tells both sides where both markers
// now stand, for "seen" ticks. The procedure may not move it as far as asked
// (never backwards, never past the newest), so the markers announced are read
// back rather than assumed.
const markRead = async (pool, { conversationId, userId, lastReadMessageId }) => {
  await MessageModel.markConversationRead(pool, conversationId, userId, lastReadMessageId);

  if (!realtimeIsOn()) return;

  try {
    const { conversation } = await MessageModel.getConversationById(pool, conversationId, userId, { limit: 1 });

    if (!conversation) return;

    emitToConversation(
      { clientId: conversation.client_id, employerId: conversation.employer_id },
      "conversation:read",
      {
        conversation_id: String(conversation.conversation_id),
        employee_last_read_message_id: conversation.employee_last_read_message_id,
        hr_last_read_message_id: conversation.hr_last_read_message_id,
      },
    );
  } catch (error) {
    console.error(`Read announcement failed for conversation ${conversationId}:`, error);
  }
};

export default { sendMessage, markRead, getConversation, getAttachment };
