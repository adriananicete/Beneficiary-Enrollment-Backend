import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";
import { createRequireCompanyMessaging } from "../../src/middlewares/requireCompanyMessaging.js";

const run = async (rows, userId = 12) => {
  let answer;
  const middleware = createRequireCompanyMessaging({
    loadPool: async () => ({}),
    getMessagingAccessByUser: async (pool, id) => {
      assert.equal(id, userId);
      return rows;
    },
  });
  await middleware({ user: { user_id: userId } }, {}, (error) => {
    answer = error ?? "passed";
  });
  return answer;
};

describe("requireCompanyMessaging", () => {
  test("allows a user whose company messaging is enabled", async () => {
    assert.equal(await run([{ messages_enabled: true }]), "passed");
    assert.equal(await run([{ messages_enabled: 1 }]), "passed");
  });

  test("refuses a disabled company and users without a company", async () => {
    for (const rows of [[{ messages_enabled: false }], []]) {
      const error = await run(rows);
      assert.equal(error.statusCode, 403);
      assert.equal(error.message, "Messaging is disabled for this company.");
    }
  });

  test("passes database errors to the error handler", async () => {
    const expected = new Error("database unavailable");
    let answer;
    const middleware = createRequireCompanyMessaging({
      loadPool: async () => ({}),
      getMessagingAccessByUser: async () => {
        throw expected;
      },
    });

    await middleware({ user: { user_id: 12 } }, {}, (error) => {
      answer = error;
    });

    assert.equal(answer, expected);
  });
});
