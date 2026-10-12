import { getPool } from "../config/db.js";
import MessageModel from "../models/messageModel.js";
import MessageService, { messageOf } from "../services/messageService.js";
import { AppError } from "../utils/AppError.js";
import { buildPage, parsePaging } from "../utils/parsePaging.js";
import {
  conversationClientIdOf,
  lastReadIdOf,
  messageBodyOf,
  messageCursorOf,
} from "../utils/validateMessage.js";

// HR ↔ employee messaging over REST, branch 8 of
// md/CLAIMS-AND-MESSAGING-DECISIONS.md. Branch 9 added the socket, which only
// announces; sending and marking read go through messageService, which saves
// and then announces. REST stays the source of truth.
//
// One set of handlers serves both sides. Every procedure scopes by the
// caller's own roles, so the employee's routes and HR's differ only in how a
// conversation is first opened and in HR's list.
//
// Answers are built field by field, so a column a procedure gains later stays
// out until somebody adds it here.
//
// The message text is the sender's own, returned as they wrote it. It must be
// shown as text, never as HTML: the frontend notes say so.

export const conversationOf = (row) => ({
  conversation_id: row.conversation_id,
  client_id: row.client_id,
  employer_id: row.employer_id,
  employee_name: row.employee_name,
  company_name: row.company_name,
  created_date: row.created_date,
  last_message_id: row.last_message_id,
  last_message_date: row.last_message_date,
  employee_last_read_message_id: row.employee_last_read_message_id,
  hr_last_read_message_id: row.hr_last_read_message_id,
  can_send: row.can_send,
});

// The same shape over REST and over the socket, so it lives in messageService.
export { messageOf };

// A row of HR's list.
export const conversationListItemOf = (row) => ({
  conversation_id: row.conversation_id,
  client_id: row.client_id,
  employee_name: row.employee_name,
  last_message_date: row.last_message_date,
  last_message_preview: row.last_message_preview,
  last_message_sender_role: row.last_message_sender_role,
  unread_count: row.unread_count,
  can_send: row.can_send,
});

const opened = (res, row) =>
  res.status(row.created ? 201 : 200).json({
    success: true,
    data: { conversation_id: row.conversation_id, created: Boolean(row.created) },
  });

// The employee's conversation with their current company, created the first
// time it is opened.
export const openMyConversation = async (req, res, next) => {
  try {
    const pool = await getPool();

    const row = await MessageModel.openConversation(pool, req.user.user_id);

    return opened(res, row);
  } catch (error) {
    next(error);
  }
};

// HR opens a conversation with one of their company's employees. The
// procedure checks the employee is theirs (50171) and refuses to start one
// with a closed account (50173); an existing one is returned either way.
export const openConversation = async (req, res, next) => {
  try {
    const clientId = conversationClientIdOf(req.body?.client_id);

    const pool = await getPool();

    const row = await MessageModel.openConversation(pool, req.user.user_id, clientId);

    return opened(res, row);
  } catch (error) {
    next(error);
  }
};

// HR's list, unread first.
export const getConversations = async (req, res, next) => {
  try {
    const paging = parsePaging(req.query);

    const pool = await getPool();

    const rows = await MessageModel.getConversationsByUser(pool, req.user.user_id, paging);

    return res.status(200).json({
      success: true,
      data: buildPage(rows, paging, conversationListItemOf),
    });
  } catch (error) {
    next(error);
  }
};

// One conversation and a page of its messages, newest first. For older ones,
// ask again with `before` set to the oldest message id on screen.
export const getConversation = async (req, res, next) => {
  try {
    const cursor = messageCursorOf(req.query);

    const pool = await getPool();

    const { conversation, messages, hasMore } = await MessageModel.getConversationById(
      pool,
      req.params.conversation_id,
      req.user.user_id,
      cursor,
    );

    // Another employee's, or another company's, comes back empty and is
    // answered exactly like one that does not exist.
    if (!conversation) throw new AppError("Conversation not found", 404);

    return res.status(200).json({
      success: true,
      data: {
        conversation: conversationOf(conversation),
        messages: messages.map(messageOf),
        has_more: hasMore,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const sendMessage = async (req, res, next) => {
  try {
    const body = messageBodyOf(req.body?.body);

    const pool = await getPool();

    // Saved, then announced to both sides' open screens.
    const message = await MessageService.sendMessage(pool, {
      conversationId: req.params.conversation_id,
      userId: req.user.user_id,
      body,
    });

    return res.status(201).json({ success: true, data: message });
  } catch (error) {
    next(error);
  }
};

export const markConversationRead = async (req, res, next) => {
  try {
    const lastReadMessageId = lastReadIdOf(req.body?.last_read_message_id);

    const pool = await getPool();

    await MessageService.markRead(pool, {
      conversationId: req.params.conversation_id,
      userId: req.user.user_id,
      lastReadMessageId,
    });

    return res.status(200).json({ success: true, message: "Marked as read" });
  } catch (error) {
    next(error);
  }
};

// The badge: conversations with something unread for HR, unread messages for
// an employee.
export const getUnreadMessageCount = async (req, res, next) => {
  try {
    const pool = await getPool();

    const unreadCount = await MessageModel.getUnreadCountByUser(pool, req.user.user_id);

    return res.status(200).json({ success: true, data: { unreadCount } });
  } catch (error) {
    next(error);
  }
};
