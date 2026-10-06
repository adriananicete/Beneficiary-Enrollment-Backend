import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { validatePassword } from "../../src/utils/validatePassword.js";

// The rule, and the two messages, are pinned as literals rather than read from
// the module's constants. Changing the rule has to change these too.
const RULE =
  "Password must be 8 to 64 characters and include an uppercase letter, " +
  "a lowercase letter, a number and a special character";
const TOO_LONG =
  "Password is too long. Use a shorter one, or fewer accented letters and emoji";

describe("validatePassword — accepts", () => {
  for (const [label, password] of [
    ["the example agreed on 2026-10-06", "Pa$$w0rd"],
    ["exactly 8 characters", "Abcde1!x"],
    ["exactly 64 characters", "Aa1$" + "x".repeat(60)],
    ["Ñ as the capital", "Ñandu$12"],
    ["ñ as the only small letter", "PAñO$123"],
    ["a space alongside a real special character", "Pa$ w0rd"],
    ["an emoji as the special character", "Pass1😀wd"],
    ["an emoji counted as one character, making 8", "Aa1😀xxxx"],
    ["exactly 72 bytes, with ñ taking two each", "Aa1$" + "ñ".repeat(34)],
  ])
    test(label, () => {
      assert.equal(validatePassword(password), null, JSON.stringify(password));
    });
});

describe("validatePassword — refuses", () => {
  for (const [label, password] of [
    ["no special character", "Password1"],
    ["no uppercase letter", "pa$$w0rd"],
    ["no lowercase letter", "PA$$W0RD"],
    ["no number", "Pa$$word"],
    ["7 characters", "Pa$$w0r"],
    ["65 characters", "Aa1$" + "x".repeat(61)],
    ["empty", ""],
    // A space is allowed, but it is not the special character.
    ["a space as the only special character", "Pass w0rd"],
    // The tilde of an ñ typed as n + combining tilde is part of a letter.
    ["a combining tilde as the only special character", "Paño1234"],
    // String.length says 8. There are 7 characters.
    ["7 characters, one of them an emoji", "Aa1😀xxx"],
  ])
    test(label, () => {
      assert.equal(validatePassword(password), RULE, JSON.stringify(password));
    });

  test("anything that is not text", () => {
    for (const password of [undefined, null, 12345678, ["Pa$$w0rd"], { a: 1 }])
      assert.equal(validatePassword(password), RULE, JSON.stringify(password));
  });

  // 38 characters, inside the 64, but 76 bytes. bcrypt would ignore everything
  // after byte 72, so the end of this password would not count.
  test("over 72 bytes, though under 64 characters", () => {
    assert.equal(validatePassword("Aa1$" + "ñ".repeat(36)), TOO_LONG);
  });
});
