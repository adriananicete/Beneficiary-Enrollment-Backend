import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";

const { createRequireCompanyMessaging } = await import("../../src/middlewares/requireCompanyMessaging.js");

// The gate in front of every conversation route. Its rule is tested in
// messagingAccess.test.js; this proves the gate applies it, asks for the right
// user, and refuses with 403.

const run = async (companies, { user_id = 3 } = {}) => {
  const asked = [];
  const gate = createRequireCompanyMessaging({
    loadPool: async () => ({ fake: true }),
    loadAccess: async (pool, userId) => {
      asked.push({ pool, userId });
      if (companies instanceof Error) throw companies;
      return companies;
    },
  });

  let passed = false;
  let refused = null;

  await gate({ user: { user_id } }, {}, (error) => {
    if (error) refused = error;
    else passed = true;
  });

  return { passed, refused, asked };
};

describe("requireCompanyMessaging", () => {
  test("lets the request through when the caller's company has messaging on", async () => {
    const { passed, refused } = await run([{ employer_id: "1", messages_enabled: true }]);

    assert.equal(passed, true);
    assert.equal(refused, null);
  });

  test("refuses with 403 when it is off", async () => {
    const { passed, refused } = await run([{ employer_id: "1", messages_enabled: false }]);

    assert.equal(passed, false);
    assert.equal(refused.statusCode, 403);
    assert.equal(refused.message, "Messaging is disabled for this company.");
  });

  test("refuses when one of two companies is off", async () => {
    const { refused } = await run([
      { employer_id: "1", messages_enabled: true },
      { employer_id: "2", messages_enabled: false },
    ]);

    assert.equal(refused?.statusCode, 403);
  });

  test("refuses a caller with no company", async () => {
    assert.equal((await run([])).refused?.statusCode, 403);
  });

  test("asks about the caller, on the pool it was given", async () => {
    const { asked } = await run([{ employer_id: "1", messages_enabled: true }], { user_id: 42 });

    assert.deepEqual(asked, [{ pool: { fake: true }, userId: 42 }]);
  });

  // A database error is passed on as it is, for errorHandler to answer as a
  // 500; it is not a reason to say messaging is off.
  test("passes a database error on, unchanged", async () => {
    const failure = new Error("database unreachable");
    const { passed, refused } = await run(failure);

    assert.equal(passed, false);
    assert.equal(refused, failure);
  });
});
