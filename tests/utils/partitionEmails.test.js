import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_INVITATION_EMAILS,
  partitionEmails,
} from "../../src/utils/partitionEmails.js";

describe("partitionEmails", () => {
  test("splits the batch instead of failing it", () => {
    // HR uploads a file, so a bad row is expected rather than exceptional. One
    // typo must not stop nine hundred good addresses going out.
    const { valid, rejected } = partitionEmails([
      "one@example.com",
      "not-an-email",
      "two@example.com",
    ]);

    assert.deepEqual(valid, ["one@example.com", "two@example.com"]);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].status, "invalid");
  });

  test("normalises what it keeps", () => {
    const { valid } = partitionEmails(["  Angela.Bautista@Example.COM  "]);

    assert.deepEqual(valid, ["angela.bautista@example.com"]);
  });

  test("reports a malformed row exactly as submitted", () => {
    // HR has to find this row in their own file. Reporting the normalised form
    // would send them looking for something they never typed.
    const { rejected } = partitionEmails(["  NOT AN EMAIL  "]);

    assert.equal(rejected[0].email, "  NOT AN EMAIL  ");
  });

  test("catches a repeat within the same upload", () => {
    const { valid, rejected } = partitionEmails([
      "same@example.com",
      "SAME@example.com",
    ]);

    assert.equal(valid.length, 1);
    assert.equal(rejected[0].status, "duplicate");
    assert.match(rejected[0].reason, /Repeated in this upload/);
  });

  test("refuses an address longer than the column", () => {
    const long = `${"a".repeat(140)}@example.com`;
    const { rejected } = partitionEmails([long]);

    assert.equal(rejected[0].status, "invalid");
    assert.match(rejected[0].reason, /Longer than 150 characters/);
  });

  test("shape is checked before length, so a long malformed row says malformed", () => {
    // Order is load-bearing: a 200-character string with no @ is reported as
    // not an email, not as too long, which is the more useful of the two.
    const { rejected } = partitionEmails(["x".repeat(200)]);

    assert.match(rejected[0].reason, /Not a valid email address/);
  });

  test("a non-string row is rejected rather than crashing the upload", () => {
    const { rejected } = partitionEmails([null, 42, {}]);

    assert.equal(rejected.length, 3);
    for (const row of rejected) {
      assert.match(row.reason, /Not a text value/);
    }
  });

  test("an empty upload returns empty lists rather than throwing", () => {
    assert.deepEqual(partitionEmails([]), { valid: [], rejected: [] });
  });

  test("the documented ceiling is a thousand", () => {
    assert.equal(MAX_INVITATION_EMAILS, 1000);
  });
});
