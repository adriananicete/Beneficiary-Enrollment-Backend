import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { hrAccountProblem } from "../../src/middlewares/validateHrAccount.js";

// The person behind a company's HR account. The username and password are the
// system's, so only a name and an email are taken.

const person = (overrides = {}) => ({
  first_name: "Maria",
  middle_name: "Cruz",
  last_name: "Santos",
  email_address: "hr@abcc.example",
  ...overrides,
});

describe("hrAccountProblem", () => {
  test("a name and an email pass; the middle name is optional", () => {
    assert.equal(hrAccountProblem(person()), null);

    const noMiddle = person();
    delete noMiddle.middle_name;
    assert.equal(hrAccountProblem(noMiddle), null);
  });

  test("trims, and an empty middle name is none", () => {
    const body = person({ first_name: " Maria ", middle_name: "  " });

    assert.equal(hrAccountProblem(body), null);
    assert.equal(body.first_name, "Maria");
    assert.equal(body.middle_name, null);
  });

  for (const field of ["first_name", "last_name", "email_address"])
    test(`${field} is required`, () => {
      assert.equal(hrAccountProblem(person({ [field]: "  " })), `${field} is required`);
    });

  test("the email must look like one", () => {
    assert.match(hrAccountProblem(person({ email_address: "hr.abcc" })), /valid email address/);
  });

  test("a name is a name: no digits", () => {
    assert.match(hrAccountProblem(person({ first_name: "Maria2" })), /first_name may only contain/);
  });

  test("the columns' widths: names 100, email 150", () => {
    assert.equal(hrAccountProblem(person({ last_name: "S".repeat(101) })), "last_name must not exceed 100 characters");
    assert.equal(
      hrAccountProblem(person({ email_address: `${"a".repeat(140)}@abcc.example` })),
      "email_address must not exceed 150 characters",
    );
  });

  // The system makes both. A username or password sent here would be ignored
  // without a word, so it is refused instead.
  test("a username or password is refused by name", () => {
    assert.equal(hrAccountProblem(person({ username: "hr.me" })), "username is not a field of an HR account");
    assert.equal(hrAccountProblem(person({ password: "x" })), "password is not a field of an HR account");
  });
});
