import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { validatePassword } from "../../src/utils/validatePassword.js";

// The rule, and the two messages, are pinned as literals rather than read from
// the module's constants. Changing the rule has to change these too.
const RULE =
  "Password must be 9 to 64 characters and include an uppercase letter, " +
  "a lowercase letter, a number and a special character";
const TOO_LONG =
  "Password is too long. Use a shorter one, or fewer accented letters and emoji";

describe("validatePassword — accepts", () => {
  for (const [label, password] of [
    ["the 2026-10-06 example with one more character", "Pa$$w0rd1"],
    ["exactly 9 characters", "Abcde1!xy"],
    ["exactly 64 characters", "Aa1$" + "x".repeat(60)],
    ["Ñ as the capital", "Ñandu$123"],
    ["ñ as the only small letter", "PAñO$1234"],
    ["a space alongside a real special character", "Pa$ w0rd1"],
    ["an emoji as the special character", "Pass1😀wrd"],
    ["an emoji counted as one character, making 9", "Aa1😀xxxxx"],
    ["exactly 72 bytes, with ñ taking two each", "Aa1$" + "ñ".repeat(34)],
  ])
    test(label, () => {
      assert.equal(validatePassword(password), null, JSON.stringify(password));
    });
});

describe("validatePassword — refuses", () => {
  for (const [label, password] of [
    ["no special character", "Password1"],
    ["no uppercase letter", "pa$$w0rd1"],
    ["no lowercase letter", "PA$$W0RD1"],
    ["no number", "Pa$$words"],
    // The minimum until 2026-11-11, and the example agreed on 2026-10-06.
    ["8 characters", "Pa$$w0rd"],
    ["65 characters", "Aa1$" + "x".repeat(61)],
    ["empty", ""],
    // A space is allowed, but it is not the special character.
    ["a space as the only special character", "Pass w0rd"],
    // The tilde of an ñ typed as n + combining tilde is part of a letter.
    ["a combining tilde as the only special character", "Paño1234"],
    // String.length says 9. There are 8 characters.
    ["8 characters, one of them an emoji", "Aa1😀xxxx"],
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
