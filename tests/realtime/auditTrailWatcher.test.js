import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";
import {
  createAuditTrailWatcher,
  AUDIT_TRAIL_POLL_INTERVAL_MS,
  AUDIT_TRAIL_RECENT_WINDOW,
} from "../../src/realtime/auditTrailWatcher.js";

describe("the audit trail realtime watcher", () => {
  test("uses a bounded poll and publishes each newly visible row once", async () => {
    let rows = ["9", "8", "7"];
    let tick;
    let configuredInterval;
    const published = [];
    let unrefCalled = false;
    let cleared = false;
    const watcher = createAuditTrailWatcher({
      getPool: async () => ({}),
      getRecentAuditIds: async (_pool, limit) => {
        assert.equal(limit, AUDIT_TRAIL_RECENT_WINDOW);
        return rows;
      },
      getAuditIdsAfter: async (_pool, afterId) =>
        rows.filter((id) => BigInt(id) > BigInt(afterId)),
      publish: (auditId) => published.push(auditId),
      setIntervalFn: (callback, interval) => {
        tick = callback;
        configuredInterval = interval;
        return { unref: () => { unrefCalled = true; } };
      },
      clearIntervalFn: () => { cleared = true; },
    });

    await watcher.ready;
    assert.equal(configuredInterval, AUDIT_TRAIL_POLL_INTERVAL_MS);
    assert.equal(unrefCalled, true);

    rows = ["11", "10", "9", "8", "7"];
    await tick();
    assert.deepEqual(published, ["10", "11"]);

    await tick();
    assert.deepEqual(published, ["10", "11"]);

    watcher.stop();
    assert.equal(cleared, true);
    await tick();
    assert.deepEqual(published, ["10", "11"]);
  });

  test("publishes every new row when more than 100 audits arrive between polls", async () => {
    let rows = ["1"];
    let tick;
    const published = [];
    const watcher = createAuditTrailWatcher({
      getPool: async () => ({}),
      getRecentAuditIds: async () => rows,
      getAuditIdsAfter: async (_pool, afterId) =>
        rows.filter((id) => BigInt(id) > BigInt(afterId)),
      publish: (auditId) => published.push(auditId),
      setIntervalFn: (callback) => {
        tick = callback;
        return { unref() {} };
      },
      clearIntervalFn() {},
    });

    await watcher.ready;
    rows = Array.from({ length: 150 }, (_, index) => String(index + 2));
    await tick();

    assert.equal(published.length, 150);
    assert.deepEqual(published, Array.from({ length: 150 }, (_, index) => String(index + 2)));

    watcher.stop();
  });

  test("retries after database errors and logs one error per failure streak", async () => {
    let tick;
    let fail = true;
    const errors = [];
    const published = [];
    const watcher = createAuditTrailWatcher({
      getPool: async () => ({}),
      getRecentAuditIds: async () => {
        if (fail) throw new Error("database unavailable");
        return ["2"];
      },
      getAuditIdsAfter: async () => {
        if (fail) throw new Error("database unavailable");
        return ["2"];
      },
      publish: (auditId) => published.push(auditId),
      logError: (...args) => errors.push(args),
      setIntervalFn: (callback) => {
        tick = callback;
        return { unref() {} };
      },
      clearIntervalFn() {},
    });

    await watcher.ready;
    await tick();
    assert.equal(errors.length, 1);

    fail = false;
    await tick();
    fail = true;
    await tick();
    assert.equal(errors.length, 2);

    watcher.stop();
    assert.deepEqual(published, []);
  });
});
