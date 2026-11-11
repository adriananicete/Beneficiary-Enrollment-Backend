import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { isOn, messagingAllowed, MESSAGING_OFF } from "../../src/utils/messagingAccess.js";

// The rule behind the company messaging switch, decided 2026-11-11: every
// company of the caller has messaging on, and there is at least one.

const on = (employer_id) => ({ employer_id, messages_enabled: true });
const off = (employer_id) => ({ employer_id, messages_enabled: false });

describe("messagingAllowed", () => {
  test("one company, on: allowed", () => {
    assert.equal(messagingAllowed([on("1")]), true);
  });

  test("one company, off: refused", () => {
    assert.equal(messagingAllowed([off("1")]), false);
  });

  // The case that separates "every" from "any". The teammates' version let
  // this through, and the company switched off kept its messaging.
  test("two companies, one off: refused", () => {
    assert.equal(messagingAllowed([on("1"), off("2")]), false);
    assert.equal(messagingAllowed([off("2"), on("1")]), false);
  });

  test("two companies, both on: allowed", () => {
    assert.equal(messagingAllowed([on("1"), on("2")]), true);
  });

  // No company at all, such as an HR account with no mapping, is not allowed
  // by default: every() of nothing is true, and that must not open the door.
  test("no company: refused", () => {
    assert.equal(messagingAllowed([]), false);
  });

  test("anything that is not a list: refused", () => {
    for (const rows of [undefined, null, {}, "rows"]) assert.equal(messagingAllowed(rows), false, JSON.stringify(rows));
  });
});

describe("isOn", () => {
  // A BIT arrives as a boolean. NULL is off, as the access procedure reads it.
  test("true and 1 are on; false, 0, NULL and anything else are off", () => {
    for (const value of [true, 1]) assert.equal(isOn(value), true, JSON.stringify(value));
    for (const value of [false, 0, null, undefined, "1", "true"]) assert.equal(isOn(value), false, JSON.stringify(value));
  });
});

test("the refusal, pinned as a literal", () => {
  assert.equal(MESSAGING_OFF, "Messaging is disabled for this company.");
});
