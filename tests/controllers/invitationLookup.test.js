import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";
import { makeNext, makeReq, makeRes } from "../helpers/http.js";

const { getInvitationByToken, publicInvitation } = await import(
  "../../src/controllers/enrollmentController.js"
);

// GET /enrollment/invitation needs no account: whoever holds a link gets this
// answer. The row is the one usp_sel_enrollment_invitation_by_token returns,
// read 2026-10-14. Values are as the driver hands them over, including the
// bare INT is_valid and is_enrolled this procedure computes.
const row = {
  invitation_id: "41",
  employer_id: "2",
  company_code: "HCL",
  company_name: "HCL Technologies",
  email_address: "jdceblano6@gmail.com",
  sent_date: new Date("2026-09-02T08:04:58.280Z"),
  expiry_date: new Date("2026-09-09T08:04:58.280Z"),
  is_valid: 1,
  is_enrolled: 0,
  client_id: null,
};

// The class and the affiliate HR assigned, as the procedure returns them
// since DBA requests 23 and 25.
const assigned = {
  classification_id: "54",
  classification_code: "CLASS 4",
  classification_desc: "Rank and file",
  affiliate_id: "7",
  affiliate_code: "ALAKOR",
  affiliate_name: "Alakor Corporation",
};

describe("publicInvitation — what the public lookup may show", () => {
  // Pinned as a literal: the ten FRONTEND-API.md documents, and the class and
  // the affiliate branch 6 adds. Changing the list changes that contract.
  test("answers with the ten documented fields, the class and the affiliate", () => {
    assert.deepEqual(Object.keys(publicInvitation(row)).sort(), [
      "affiliate",
      "classification",
      "client_id",
      "company_code",
      "company_name",
      "email_address",
      "employer_id",
      "expiry_date",
      "invitation_id",
      "is_enrolled",
      "is_valid",
      "sent_date",
    ]);
  });

  // An invitation sent before branch 6: the form shows the class dropdown.
  test("passes each value through as it came, with no class and no affiliate", () => {
    assert.deepEqual(publicInvitation(row), { ...row, classification: null, affiliate: null });
    assert.deepEqual(
      publicInvitation({ ...row, classification_id: null, affiliate_id: null }),
      { ...row, classification: null, affiliate: null },
    );
  });

  test("the assigned class and affiliate each come as one object", () => {
    const shown = publicInvitation({ ...row, ...assigned });

    assert.deepEqual(shown.classification, {
      classification_id: "54",
      classification_code: "CLASS 4",
      classification_desc: "Rank and file",
    });
    assert.deepEqual(shown.affiliate, {
      affiliate_id: "7",
      affiliate_code: "ALAKOR",
      affiliate_name: "Alakor Corporation",
    });
  });

  // The company itself: a class, and no affiliate.
  test("a class with no affiliate", () => {
    const shown = publicInvitation({ ...row, ...assigned, affiliate_id: null, affiliate_code: null, affiliate_name: null });

    assert.equal(shown.classification.classification_code, "CLASS 4");
    assert.equal(shown.affiliate, null);
  });

  // The company's age limit and the token, which the HR procedures return
  // beside the same names, stay out; so do the flat columns the two objects
  // are built from.
  test("leaves out anything else a procedure returns", () => {
    const shown = publicInvitation({
      ...row,
      ...assigned,
      token: "a".repeat(64),
      online_enrollment_max_age: 65,
      reference_no: "G-TLI-26-177-1",
    });

    for (const key of ["token", "online_enrollment_max_age", "reference_no", ...Object.keys(assigned)])
      assert.equal(key in shown, false, key);
  });
});

describe("getInvitationByToken — refused before the database", () => {
  // getPool is never reached, so these run without one.
  test("no token is 400", async () => {
    const next = makeNext();

    await getInvitationByToken(makeReq(), makeRes(), next);

    assert.deepEqual(next.refusal(), { statusCode: 400, message: "Token is required" });
  });

  test("a token that cannot be one is 404, like one that does not exist", async () => {
    const next = makeNext();

    await getInvitationByToken(makeReq({ query: { token: "x".repeat(65) } }), makeRes(), next);

    assert.deepEqual(next.refusal(), { statusCode: 404, message: "Invitation not found" });
  });
});
