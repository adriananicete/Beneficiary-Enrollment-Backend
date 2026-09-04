import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { chunk, delay, runWithConcurrency } from "../../src/utils/concurrency.js";

describe("chunk", () => {
  test("splits into groups of the requested size", () => {
    assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  });

  test("a list shorter than the size is one group", () => {
    assert.deepEqual(chunk([1, 2], 10), [[1, 2]]);
  });

  test("an exact multiple leaves no short group at the end", () => {
    assert.deepEqual(chunk([1, 2, 3, 4], 2), [[1, 2], [3, 4]]);
  });

  test("an empty list is no groups, not one empty group", () => {
    assert.deepEqual(chunk([], 5), []);
  });
});

describe("runWithConcurrency", () => {
  test("visits every item exactly once", async () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const seen = [];

    await runWithConcurrency(items, 4, async (item) => {
      seen.push(item);
    });

    assert.equal(seen.length, items.length);
    assert.deepEqual([...seen].sort((a, b) => a - b), items);
  });

  test("passes the index alongside the item", async () => {
    const pairs = [];

    await runWithConcurrency(["a", "b", "c"], 2, async (item, index) => {
      pairs.push([item, index]);
    });

    assert.deepEqual(
      pairs.sort((x, y) => x[1] - y[1]),
      [["a", 0], ["b", 1], ["c", 2]],
    );
  });

  test("never exceeds the limit", async () => {
    // The limit exists because Microsoft Graph caps concurrent sends per
    // mailbox. Exceeding it is throttling, not a crash, which is exactly the
    // kind of failure nobody notices until a thousand-address upload.
    let inFlight = 0;
    let peak = 0;

    await runWithConcurrency(Array.from({ length: 30 }), 4, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await delay(1);
      inFlight -= 1;
    });

    assert.ok(peak <= 4, `peak concurrency was ${peak}, limit was 4`);
  });

  test("a limit larger than the list does not spawn idle workers", async () => {
    let peak = 0;
    let inFlight = 0;

    await runWithConcurrency([1, 2], 50, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await delay(1);
      inFlight -= 1;
    });

    assert.ok(peak <= 2, `peak concurrency was ${peak}, only 2 items existed`);
  });

  test("an empty list resolves without calling the worker", async () => {
    let called = false;

    await runWithConcurrency([], 4, async () => {
      called = true;
    });

    assert.equal(called, false);
  });

  test("a worker rejection propagates rather than being swallowed", async () => {
    await assert.rejects(
      runWithConcurrency([1], 1, async () => {
        throw new Error("worker failed");
      }),
      /worker failed/,
    );
  });
});
