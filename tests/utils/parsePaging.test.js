import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  buildPage,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  parsePaging,
  parseSearch,
} from "../../src/utils/parsePaging.js";

describe("the paging contract", () => {
  // Pinned as literals rather than against the constants themselves. Asserting
  // `parsePaging({pageSize:'5000'}).pageSize === MAX_PAGE_SIZE` cannot fail —
  // change the constant and the assertion moves with it. These numbers are a
  // published contract: FRONTEND-API.md tells the frontend "default 25, hard
  // cap 100", so changing either is a breaking change and should break a test.
  test("the default page size is 25", () => {
    assert.equal(DEFAULT_PAGE_SIZE, 25);
  });

  test("the hard cap is 100", () => {
    assert.equal(MAX_PAGE_SIZE, 100);
  });
});

describe("parsePaging", () => {
  test("defaults when nothing is passed", () => {
    assert.deepEqual(parsePaging(), { page: 1, pageSize: 25 });
    assert.deepEqual(parsePaging({}), { page: 1, pageSize: 25 });
  });

  test("reads numbers out of query strings", () => {
    assert.deepEqual(parsePaging({ page: "3", pageSize: "5" }), {
      page: 3,
      pageSize: 5,
    });
  });

  test("clamps rather than refusing an oversized page", () => {
    // An uncapped page size hands the whole problem back to the caller — one
    // request for 100,000 rows undoes paging entirely.
    assert.equal(parsePaging({ pageSize: "5000" }).pageSize, 100);
    assert.equal(parsePaging({ pageSize: "101" }).pageSize, 100);
    assert.equal(parsePaging({ pageSize: "100" }).pageSize, 100);
  });

  test("falls back rather than erroring on input that is not a page number", () => {
    // A bad value in a query string is a caller mistake with an obvious right
    // answer. Answering 400 would break a list that could simply have been shown.
    for (const page of ["0", "-3", "abc", "1.5", "", null]) {
      assert.equal(parsePaging({ page }).page, 1, `page=${JSON.stringify(page)}`);
    }

    assert.equal(parsePaging({ pageSize: "0" }).pageSize, 25);
  });
});

describe("parseSearch", () => {
  test("an empty or blank search is no search", () => {
    // "" would reach the procedure as LIKE '%%', matching every row and paying
    // for a scan to do it.
    assert.equal(parseSearch(""), null);
    assert.equal(parseSearch("   "), null);
  });

  test("anything that is not a string is no search", () => {
    assert.equal(parseSearch(undefined), null);
    assert.equal(parseSearch(null), null);
    assert.equal(parseSearch(42), null);
  });

  test("trims what it keeps", () => {
    assert.equal(parseSearch("  cruz  "), "cruz");
  });
});

describe("buildPage", () => {
  const paging = { page: 2, pageSize: 5 };

  test("an empty set reports a total of 0, not undefined", () => {
    // THE regression this helper exists for. A filtered set with no matches
    // returns no rows and therefore no COUNT(*) OVER(), so reading the total
    // off row zero without a guard yields undefined rows out of a NaN page
    // count. This is the one way the shape breaks.
    const page = buildPage([], paging);

    assert.deepEqual(page, {
      rows: [],
      page: 2,
      pageSize: 5,
      total: 0,
      totalPages: 0,
    });
    assert.notEqual(page.total, undefined);
    assert.ok(Number.isFinite(page.totalPages));
  });

  test("lifts the total off the first row and drops it from every row", () => {
    const page = buildPage(
      [
        { id: 1, total_count: 12 },
        { id: 2, total_count: 12 },
      ],
      paging,
    );

    assert.equal(page.total, 12);
    assert.equal(page.totalPages, 3);
    assert.deepEqual(page.rows, [{ id: 1 }, { id: 2 }]);

    for (const row of page.rows) {
      assert.ok(!("total_count" in row), "total_count must not survive");
    }
  });

  test("the transform can drop a field, which is how the token is stripped", () => {
    // The invitation token opens the enrollment form as the invited person. It
    // must never reach a browser — this is what PR #49 fixed.
    const page = buildPage(
      [{ invitation_id: "1", token: "secret", total_count: 1 }],
      paging,
      ({ token, ...rest }) => rest,
    );

    assert.deepEqual(page.rows, [{ invitation_id: "1" }]);
    assert.ok(!JSON.stringify(page.rows).includes("secret"));
  });

  test("carries the requested page and size back out unchanged", () => {
    const page = buildPage([{ total_count: 3 }], { page: 7, pageSize: 25 });

    assert.equal(page.page, 7);
    assert.equal(page.pageSize, 25);
  });
});
