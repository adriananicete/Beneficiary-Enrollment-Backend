import MessageModel from "../models/messageModel.js";
import { emitToConversation, realtimeIsOn } from "../realtime/realtime.js";

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
});

// `body` has already been through messageBodyOf.
const sendMessage = async (pool, { conversationId, userId, body }) => {
  const saved = await MessageModel.insertMessage(pool, { conversationId, userId, body });

  const message = { conversation_id: saved.conversation_id, ...messageOf(saved) };

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

export default { sendMessage, markRead };
