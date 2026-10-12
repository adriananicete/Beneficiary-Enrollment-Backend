import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  conversationClientIdOf,
  lastReadIdOf,
  messageBodyOf,
  messageCursorOf,
} from "../../src/utils/validateMessage.js";

// What a messaging request may carry, judged before the database. Text only,
// trimmed, 1 to 2,000 characters (decided 2026-10-06); history by cursor
// (decided 2026-10-12).

const refusal = (fn) => {
  try {
    fn();
  } catch (error) {
    return { statusCode: error.statusCode, message: error.message };
  }
  return null;
};

describe("messageBodyOf", () => {
  test("trims the ends and keeps the newlines inside", () => {
    assert.equal(messageBodyOf("  Hello,\nsee you Monday.\n\n"), "Hello,\nsee you Monday.");
  });

  test("blank, or only spaces, newlines and tabs, is 400", () => {
    for (const value of ["", "   ", "\n\n", "\t \n"])
      assert.deepEqual(refusal(() => messageBodyOf(value)), { statusCode: 400, message: "A message cannot be empty" }, JSON.stringify(value));
  });

  test("anything but text is 400", () => {
    for (const value of [undefined, null, 1, true, {}, ["hi"], { toString: 1 }])
      assert.deepEqual(refusal(() => messageBodyOf(value)), { statusCode: 400, message: "body must be text" }, JSON.stringify(value));
  });

  // Pinned as a literal: the column is NVARCHAR(2000).
  test("2000 characters is accepted and 2001 is 400", () => {
    assert.equal(messageBodyOf("x".repeat(2000)).length, 2000);
    assert.deepEqual(refusal(() => messageBodyOf("x".repeat(2001))), {
      statusCode: 400,
      message: "A message can be at most 2000 characters",
    });
  });

  // The length is counted after trimming, as the procedure counts it.
  test("spaces around a full message do not count against it", () => {
    assert.equal(messageBodyOf(`  ${"x".repeat(2000)}  `).length, 2000);
  });

  // An emoji is two UTF-16 code units in JavaScript and to LEN() on
  // NVARCHAR, so the two sides agree on where the limit falls.
  test("an emoji counts as two, the way SQL Server counts it", () => {
    assert.equal(messageBodyOf("🙂".repeat(1000)).length, 2000);
    assert.equal(refusal(() => messageBodyOf(`${"🙂".repeat(1000)}x`)).statusCode, 400);
  });

  test("ñ and accents are kept as typed", () => {
    assert.equal(messageBodyOf("Salamat po, Peña."), "Salamat po, Peña.");
  });
});

describe("messageCursorOf", () => {
  test("no cursor is the newest page of 50", () => {
    assert.deepEqual(messageCursorOf({}), { before: null, limit: 50 });
    assert.deepEqual(messageCursorOf(), { before: null, limit: 50 });
    assert.deepEqual(messageCursorOf({ before: "" }), { before: null, limit: 50 });
  });

  test("before is an id, as text", () => {
    assert.deepEqual(messageCursorOf({ before: "120", limit: "20" }), { before: "120", limit: 20 });
    assert.equal(messageCursorOf({ before: 120 }).before, "120");
  });

  // An id is not guessed: a wrong one would show the wrong messages.
  test("a before that is not an id is 400", () => {
    for (const before of ["abc", "-1", "1.5", "12 ", ["120"], { a: 1 }, "1".repeat(19)])
      assert.deepEqual(refusal(() => messageCursorOf({ before })), { statusCode: 400, message: "before must be a message id" }, JSON.stringify(before));
  });

  // Clamped rather than refused, as parsePaging treats a page size.
  test("limit is clamped to 1–100, and anything unreadable is the default", () => {
    assert.equal(messageCursorOf({ limit: "100" }).limit, 100);
    assert.equal(messageCursorOf({ limit: "5000" }).limit, 100);
    assert.equal(messageCursorOf({ limit: "1" }).limit, 1);

    for (const limit of ["0", "-5", "abc", undefined, [], {}])
      assert.equal(messageCursorOf({ limit }).limit, 50, JSON.stringify(limit));
  });
});

describe("the ids a messaging request carries", () => {
  test("an id as text or a number comes back as text", () => {
    assert.equal(lastReadIdOf("120"), "120");
    assert.equal(lastReadIdOf(120), "120");
    assert.equal(conversationClientIdOf("75"), "75");
  });

  // At most 18 digits, so it always fits the BigInt it is bound as. A longer
  // one is a driver error, which answers 500.
  test("an id longer than a BigInt can hold is refused", () => {
    assert.equal(lastReadIdOf("9".repeat(18)), "9".repeat(18));
    assert.equal(refusal(() => lastReadIdOf("9".repeat(19))).statusCode, 400);
  });

  test("anything else is 400, with the field named", () => {
    for (const value of [undefined, null, "", "abc", -1, 1.5, {}, ["1"], { toString: 1 }]) {
      assert.deepEqual(refusal(() => lastReadIdOf(value)), { statusCode: 400, message: "last_read_message_id must be a message id" }, JSON.stringify(value));
      assert.deepEqual(refusal(() => conversationClientIdOf(value)), { statusCode: 400, message: "client_id is required" }, JSON.stringify(value));
    }
  });
});
