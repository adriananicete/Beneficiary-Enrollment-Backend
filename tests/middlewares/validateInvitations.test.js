import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { validateInvitations } from "../../src/middlewares/validateInvitations.js";
import { MAX_INVITATION_EMAILS } from "../../src/utils/partitionInvitations.js";
import { makeNext, makeReq, makeRes } from "../helpers/http.js";

const run = (body) => {
  const next = makeNext();
  validateInvitations(makeReq({ body }), makeRes(), next);
  return next;
};

const row = (i = 0) => ({
  email_address: `person${i}@example.com`,
  classification_code: "CLASS 4",
  affiliate_code: "ALAKOR",
});

describe("validateInvitations", () => {
  test("lets a normal upload through", () => {
    assert.ok(run({ invitations: [row(1), row(2)] }).passed());
  });

  test("a batch of bad rows still passes this middleware", () => {
    // Only failures that make the request itself unusable belong here. Bad rows
    // inside the batch are classified per row in the service, so a single
    // typo no longer rejects an entire upload.
    assert.ok(run({ invitations: [{ email_address: "not-an-email" }, null, "also bad"] }).passed());
  });

  // The shape before branch 6 of the onboarding effort, named so a frontend
  // still sending it learns what changed.
  test("the old emails shape is refused by name", () => {
    assert.deepEqual(run({ emails: ["one@example.com"] }).refusal(), {
      statusCode: 400,
      message:
        "emails is no longer accepted. Send invitations: [{ email_address, classification_code, affiliate_code }]",
    });
  });

  test("refuses anything that is not an array", () => {
    for (const invitations of [undefined, null, "one@example.com", {}]) {
      const refusal = run({ invitations }).refusal();

      assert.equal(refusal.statusCode, 400);
      assert.equal(refusal.message, "invitations must be an array");
    }
  });

  test("refuses a request with no body at all", () => {
    assert.equal(run(undefined).refusal().statusCode, 400);
  });

  test("refuses an empty upload", () => {
    assert.deepEqual(run({ invitations: [] }).refusal(), {
      statusCode: 400,
      message: "At least one invitation is required",
    });
  });

  test("accepts exactly the maximum and refuses one more", () => {
    const at = Array.from({ length: MAX_INVITATION_EMAILS }, (_, i) => row(i));

    assert.ok(run({ invitations: at }).passed());

    assert.deepEqual(run({ invitations: [...at, row(MAX_INVITATION_EMAILS)] }).refusal(), {
      statusCode: 400,
      message: `A maximum of ${MAX_INVITATION_EMAILS} invitations is allowed`,
    });
  });
});
