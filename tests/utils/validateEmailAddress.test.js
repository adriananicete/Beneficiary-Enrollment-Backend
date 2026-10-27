import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { validateEmailAddress } from "../../src/utils/validateEmailAddress.js";
import { partitionEmails } from "../../src/utils/partitionEmails.js";

describe("validateEmailAddress", () => {
  test("accepts ordinary addresses", () => {
    for (const email of [
      "angela@example.com",
      "first.last+tag@sub.example.com.ph",
      "maria.santos@coforge.com",
    ])
      assert.equal(validateEmailAddress(email), null, email);
  });

  test("refuses what is plainly not an address", () => {
    for (const email of ["abc", "a@b", "angela@", "@example.com", "a b@example.com", ""])
      assert.equal(
        validateEmailAddress(email),
        "email_address must be a valid email address, as name@example.com",
        JSON.stringify(email),
      );
  });

  test("refuses anything that is not text", () => {
    for (const email of [undefined, null, 42, ["a@example.com"]])
      assert.ok(validateEmailAddress(email), JSON.stringify(email));
  });

  // One pattern for both doors. If the invitation upload and the change request
  // ever disagreed, an address HR could invite would be one the employee could
  // not keep, or the reverse.
  test("agrees with the invitation upload about every case above", () => {
    for (const email of ["angela@example.com", "abc", "a@b", "a b@example.com"]) {
      const invitable = partitionEmails([email]).valid.length === 1;
      const keepable = validateEmailAddress(email) === null;

      assert.equal(invitable, keepable, email);
    }
  });
});
