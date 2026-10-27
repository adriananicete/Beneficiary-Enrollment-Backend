import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { validateInvitations } from "../../src/middlewares/validateInvitations.js";
import { MAX_INVITATION_EMAILS } from "../../src/utils/partitionEmails.js";
import { makeNext, makeReq, makeRes } from "../helpers/http.js";

const run = (body) => {
  const next = makeNext();
  validateInvitations(makeReq({ body }), makeRes(), next);
  return next;
};

describe("validateInvitations", () => {
  test("lets a normal upload through", () => {
    assert.ok(run({ emails: ["one@example.com", "two@example.com"] }).passed());
  });

  test("a batch of bad addresses still passes this middleware", () => {
    // Only failures that make the request itself unusable belong here. Bad rows
    // inside the batch are classified per address in the service, so a single
    // typo no longer rejects an entire upload.
    assert.ok(run({ emails: ["not-an-email", "also bad"] }).passed());
  });

  test("refuses anything that is not an array", () => {
    for (const emails of [undefined, null, "one@example.com", {}]) {
      const refusal = run({ emails }).refusal();

      assert.equal(refusal.statusCode, 400);
      assert.match(refusal.message, /must be an array/);
    }
  });

  test("refuses an empty upload", () => {
    const refusal = run({ emails: [] }).refusal();

    assert.equal(refusal.statusCode, 400);
    assert.match(refusal.message, /At least one email address/);
  });

  test("accepts exactly the maximum and refuses one more", () => {
    const at = Array.from(
      { length: MAX_INVITATION_EMAILS },
      (_, i) => `person${i}@example.com`,
    );

    assert.ok(run({ emails: at }).passed());

    const refusal = run({ emails: [...at, "one.too.many@example.com"] }).refusal();

    assert.equal(refusal.statusCode, 400);
    assert.match(refusal.message, new RegExp(String(MAX_INVITATION_EMAILS)));
  });
});
