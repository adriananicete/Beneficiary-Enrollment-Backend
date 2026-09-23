import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  validateTextFields,
  CLIENT_TEXT_RULES,
  BENEFICIARY_TEXT_RULES,
} from "../../src/utils/validateTextFields.js";

const nameCheck = (value) => validateTextFields({ first_name: value }, { first_name: "name" });
const wordsCheck = (value) => validateTextFields({ relationship: value }, { relationship: "words" });

describe("validateTextFields — which fields, and of which kind", () => {
  // Pinned as literals. Adding a field to either list changes what the
  // frontend's forms may send, and should fail a test on its way in.
  test("the personal fields", () => {
    assert.deepEqual(CLIENT_TEXT_RULES, {
      first_name: "name",
      middle_name: "name",
      last_name: "name",
      suffix: "name",
      nationality: "words",
    });
  });

  test("the beneficiary fields", () => {
    assert.deepEqual(BENEFICIARY_TEXT_RULES, {
      full_name: "name",
      relationship: "words",
    });
  });
});

describe("validateTextFields — names", () => {
  test("accepts the names this system will actually see", () => {
    for (const name of [
      "Juan",
      "María José",
      "Ñoño",
      "Dela Cruz-Santos",
      "D'Souza",
      "D’Souza", // the curly apostrophe a phone substitutes
      "Ma. Cristina",
      "Jr.",
      "III",
      "O'Neil",
      "Nguyễn",
      "José", // é typed as e and a combining accent
    ])
      assert.equal(nameCheck(name), null, name);
  });

  test("refuses digits, including the four live test rows found on 2026-09-23", () => {
    for (const name of ["Juan2", "2", "TEST USER2", "Test Bene 1", "3rd"])
      assert.match(nameCheck(name), /may only contain/, name);
  });

  test("refuses symbols a name does not carry", () => {
    for (const name of ["@@@", "Juan!", "<b>Juan</b>", "Juan_Dela", "Juan/Pedro"])
      assert.match(nameCheck(name), /may only contain/, name);
  });

  test("must start with a letter", () => {
    for (const name of [".Juan", "-Santos", "'Juan", " Juan"])
      assert.match(nameCheck(name), /may only contain/, name);
  });

  test("names the field and says what is allowed", () => {
    assert.equal(
      nameCheck("Juan2"),
      "first_name may only contain letters, spaces, hyphens, apostrophes and periods",
    );
  });
});

describe("validateTextFields — words (nationality, relationship)", () => {
  test("accepts letters, spaces and hyphens", () => {
    for (const value of ["Filipino", "Son", "Step Son", "Mother-in-law", "Filipino-American"])
      assert.equal(wordsCheck(value), null, value);
  });

  test("refuses digits, periods and apostrophes", () => {
    for (const value of ["Filipino1", "Son.", "Son's", "Child 2"])
      assert.match(wordsCheck(value), /may only contain letters, spaces and hyphens/, value);
  });
});

describe("validateTextFields — what it leaves to other checks", () => {
  // Presence is the required-field check's call, and middle_name and suffix
  // may legitimately be empty.
  test("skips an absent or empty value", () => {
    for (const value of [undefined, null, ""])
      assert.equal(nameCheck(value), null, String(value));
  });

  // A number passes the required check for being truthy and would be stored as
  // its string form. An array or object would reach the procedure's binding.
  test("refuses anything that is not text", () => {
    for (const value of [123, ["Juan"], { name: "Juan" }, true])
      assert.equal(nameCheck(value), "first_name must be text", JSON.stringify(value));
  });

  test("reports the first failing field in the order given", () => {
    const error = validateTextFields(
      { first_name: "Juan", last_name: "2", nationality: "Filipino1" },
      CLIENT_TEXT_RULES,
    );

    assert.match(error, /^last_name /);
  });
});
