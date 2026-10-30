import MessageModel from "../models/messageModel.js";
import { emitToConversation, realtimeIsOn } from "../realtime/realtime.js";

const bitIsOn = (value) => value === true || value === 1 || value === "1";

// Sending and reading, and announcing both to the screens that are open.
// Branch 9: REST does the work, then the socket says it happened. Takes the
// pool, like every service since PR #102, so a test can hand it a fake.
//
// An announcement never fails the call. emitToConversation swallows its own
// errors, and the read lookup below does too: the message is saved and the
// marker moved whether or not anybody hears about it.

// The message as it leaves, over REST and over the socket alike.
export const messageOf = (row) => ({
  message_id: row.message_id,
  sender_role: row.sender_role,
  body: row.body,
  created_date: row.created_date,
  ...(row.edited_date !== undefined ? { edited_date: row.edited_date } : {}),
  ...(row.is_deleted !== undefined ? { is_deleted: bitIsOn(row.is_deleted) } : {}),
  ...(row.attachments !== undefined ? { attachments: row.attachments } : {}),
});

// `body` has already been through messageBodyOf.
const sendMessage = async (pool, { conversationId, userId, body, attachment = null }) => {
  const saved = attachment
    ? await MessageModel.insertMessageWithAttachment(pool, { conversationId, userId, body, attachment })
    : await MessageModel.insertMessage(pool, { conversationId, userId, body });
  const attachmentRow = attachment && {
    attachment_id: saved.attachment_id,
    file_name: saved.file_name,
    mime_type: saved.mime_type,
    byte_size: saved.byte_size,
  };
  const message = { conversation_id: saved.conversation_id, ...messageOf(saved) };
  if (attachmentRow) message.attachments = [attachmentRow];

  // To both sides. The procedure returns the conversation's client and
  // company for exactly this.
  emitToConversation(
    { clientId: saved.client_id, employerId: saved.employer_id },
    "message:new",
    message,
  );

  return message;
};

const editMessage = async (pool, { conversationId, messageId, userId, body }) => {
  const saved = await MessageModel.updateMessage(pool, { conversationId, messageId, userId, body });
  if (!saved) return null;
  const message = { conversation_id: saved.conversation_id, ...messageOf(saved) };
  emitToConversation({ clientId: saved.client_id, employerId: saved.employer_id }, "message:updated", message);
  return message;
};

const unsendMessage = async (pool, { conversationId, messageId, userId }) => {
  const saved = await MessageModel.softDeleteMessage(pool, { conversationId, messageId, userId });
  if (!saved) return null;
  const message = {
    conversation_id: saved.conversation_id,
    ...messageOf({ ...saved, is_deleted: true, body: "", attachments: [] }),
  };
  emitToConversation({ clientId: saved.client_id, employerId: saved.employer_id }, "message:deleted", message);
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

export default { sendMessage, editMessage, unsendMessage, markRead };
