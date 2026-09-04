import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  ADDRESS_FIELD_LENGTHS,
  BENEFICIARY_FIELD_LENGTHS,
  CLIENT_FIELD_LENGTHS,
  validateFieldLengths,
} from "../../src/utils/validateFieldLengths.js";

describe("validateFieldLengths", () => {
  test("accepts a value at exactly the limit", () => {
    assert.equal(
      validateFieldLengths({ gender: "F" }, CLIENT_FIELD_LENGTHS),
      null,
    );
  });

  test("refuses an over-length value and names the field", () => {
    // The message has to name the field: the payload has sixteen capped
    // strings and "too long" alone leaves the employee guessing which.
    const message = validateFieldLengths(
      { first_name: "a".repeat(101) },
      CLIENT_FIELD_LENGTHS,
    );

    assert.match(message, /first_name/);
    assert.match(message, /100 characters/);
  });

  test("skips anything that is not a string", () => {
    // A missing field never fails here, which is why the required-field loop
    // exists separately. Numbers pass through untouched.
    assert.equal(validateFieldLengths({}, CLIENT_FIELD_LENGTHS), null);
    assert.equal(
      validateFieldLengths({ first_name: undefined }, CLIENT_FIELD_LENGTHS),
      null,
    );
    assert.equal(
      validateFieldLengths({ tin_id: 12345 }, CLIENT_FIELD_LENGTHS),
      null,
    );
  });
});

describe("the caps themselves", () => {
  test("employee_id_number is capped at 50, matching us01_username", () => {
    // It had no cap at all until 2026-09-04, and the live data showed what that
    // allowed: a thirty-character employee id sitting in sec.us01_users as
    // somebody's login. 50 is the column width.
    assert.equal(CLIENT_FIELD_LENGTHS.employee_id_number, 50);

    assert.equal(
      validateFieldLengths(
        { employee_id_number: "H".repeat(50) },
        CLIENT_FIELD_LENGTHS,
      ),
      null,
    );

    assert.match(
      validateFieldLengths(
        { employee_id_number: "H".repeat(51) },
        CLIENT_FIELD_LENGTHS,
      ),
      /employee_id_number/,
    );
  });

  test("barangay_id allows exactly nine characters", () => {
    // Barangay codes carry a leading zero — "012801001". Anything narrower
    // would refuse a real code; anything wider would admit a malformed one.
    assert.equal(ADDRESS_FIELD_LENGTHS.barangay_id, 9);
    assert.equal(
      validateFieldLengths({ barangay_id: "012801001" }, ADDRESS_FIELD_LENGTHS),
      null,
    );
  });

  test("a beneficiary name has room for a real one", () => {
    assert.equal(BENEFICIARY_FIELD_LENGTHS.full_name, 255);
  });
});
