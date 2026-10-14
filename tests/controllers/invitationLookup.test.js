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

describe("publicInvitation — what the public lookup may show", () => {
  // Pinned as a literal: these are the ten FRONTEND-API.md documents, and
  // changing the list is a change to that contract.
  test("answers with the ten documented fields", () => {
    assert.deepEqual(Object.keys(publicInvitation(row)).sort(), [
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

  test("passes each value through as it came", () => {
    assert.deepEqual(publicInvitation(row), row);
  });

  // The columns DBA requests 23 and 25 add to the procedure, and the token,
  // which the HR procedures return beside the same names.
  test("leaves out anything a procedure adds later", () => {
    const shown = publicInvitation({
      ...row,
      token: "a".repeat(64),
      classification_id: "11",
      classification_code: "VP",
      classification_desc: "Vice President",
      online_enrollment_max_age: 65,
      affiliate_id: "3",
      affiliate_name: "Alakor Corporation",
    });

    assert.deepEqual(shown, row);
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
