import { AppError } from "./AppError.js";
import { isNumericId } from "../middlewares/validateIdParam.js";

// What a messaging request may carry, judged before the database is asked.
// Decided 2026-10-06: text only, trimmed, 1 to 2,000 characters.
//
// The procedure checks the same rules (50174, 50175). These come first so the
// common mistakes are answered without a round trip, and so the length is
// counted the same way on both sides: JavaScript's `length` and SQL Server's
// LEN() on NVARCHAR both count UTF-16 code units, so an emoji is 2 on both.

export const MAX_MESSAGE_LENGTH = 2000;

// The message, trimmed. JavaScript's trim() also takes newlines and tabs off
// the ends, which the procedure's LTRIM/RTRIM would leave; newlines inside the
// message are kept.
export const messageBodyOf = (value) => {
  if (typeof value !== "string") throw new AppError("body must be text", 400);

  const body = value.trim();

  if (!body) throw new AppError("A message cannot be empty", 400);

  if (body.length > MAX_MESSAGE_LENGTH)
    throw new AppError(`A message can be at most ${MAX_MESSAGE_LENGTH} characters`, 400);

  return body;
};

// A whole-number id given as text or as a number, or null. Text and numbers
// only: String() throws on {"toString": 1}, which once answered 500. At most
// 18 digits, so it always fits the BigInt it is bound as; a longer one is a
// driver error, which would also answer 500.
const MAX_ID_DIGITS = 18;

const idOf = (value) =>
  (typeof value === "string" || typeof value === "number") &&
  isNumericId(value) &&
  String(value).length <= MAX_ID_DIGITS
    ? String(value)
    : null;

export const DEFAULT_PAGE_OF_MESSAGES = 50;
export const MAX_PAGE_OF_MESSAGES = 100;

// The cursor for a conversation's history, decided 2026-10-12: `before` is the
// oldest message id the screen already has, and `limit` how many older ones to
// fetch. A bad `before` is refused, because it is an id and guessing one would
// show the wrong messages. `limit` is clamped rather than refused, the way
// parsePaging treats a page size.
export const messageCursorOf = ({ before, limit } = {}) => {
  let cursor = null;

  if (before !== undefined && before !== "") {
    cursor = idOf(before);
    if (cursor === null) throw new AppError("before must be a message id", 400);
  }

  const asked = Number.parseInt(limit, 10);
  const size = Number.isInteger(asked) && asked > 0
    ? Math.min(asked, MAX_PAGE_OF_MESSAGES)
    : DEFAULT_PAGE_OF_MESSAGES;

  return { before: cursor, limit: size };
};

// The id of the newest message on the reader's screen.
export const lastReadIdOf = (value) => {
  const id = idOf(value);

  if (id === null) throw new AppError("last_read_message_id must be a message id", 400);

  return id;
};

// The employee HR wants to talk to.
export const conversationClientIdOf = (value) => {
  const id = idOf(value);

  if (id === null) throw new AppError("client_id is required", 400);

  return id;
};

export default {
  messageBodyOf,
  messageCursorOf,
  lastReadIdOf,
  conversationClientIdOf,
  MAX_MESSAGE_LENGTH,
};
