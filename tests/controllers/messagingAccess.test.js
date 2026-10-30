import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";
import { makeNext, makeReq, makeRes } from "../helpers/http.js";

const { createGetMessagingAvailability } = await import(
  "../../src/controllers/messagingAccessController.js"
);

describe("GET messaging availability", () => {
  test("returns enabled when at least one authorized company allows messaging", async () => {
    let receivedUserId;
    const handler = createGetMessagingAvailability({
      getPool: async () => ({}),
      getMessagingAccessByUser: async (pool, userId) => {
        receivedUserId = userId;
        return [
          { employer_id: "1", messages_enabled: false },
          { employer_id: "2", messages_enabled: 1 },
        ];
      },
    });
    const res = makeRes();
    const next = makeNext();

    await handler(makeReq({ user: { user_id: "44" } }), res, next);

    assert.equal(receivedUserId, "44");
    assert.equal(next.calls.length, 0);
    assert.deepEqual(res.body, { success: true, data: { enabled: true } });
  });

  test("returns disabled when every authorized company has messaging off", async () => {
    const handler = createGetMessagingAvailability({
      getPool: async () => ({}),
      getMessagingAccessByUser: async () => [
        { messages_enabled: false },
        { messages_enabled: "0" },
      ],
    });
    const res = makeRes();
    const next = makeNext();

    await handler(makeReq({ user: { user_id: "44" } }), res, next);

    assert.deepEqual(res.body, { success: true, data: { enabled: false } });
  });

  test("passes database failures to the error handler", async () => {
    const databaseError = new Error("procedure unavailable");
    const handler = createGetMessagingAvailability({
      getPool: async () => ({}),
      getMessagingAccessByUser: async () => { throw databaseError; },
    });
    const next = makeNext();

    await handler(makeReq({ user: { user_id: "44" } }), makeRes(), next);

    assert.equal(next.calls[0], databaseError);
  });
});
