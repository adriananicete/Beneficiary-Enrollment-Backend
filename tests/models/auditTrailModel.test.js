import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";
import { fakePool } from "../helpers/fakePool.js";

const { default: AuditTrailModel } = await import(
  "../../src/models/auditTrailModel.js"
);

describe("AuditTrailModel.getAuditTrail", () => {
  test("binds search and inclusive date filters and sorts newest first", async () => {
    const auditRow = {
      audit_id: "9",
      action: "UPDATE",
      module: "sec.us01_users",
      record_id: "22",
      old_values: '{"email":"old@example.com"}',
      new_values: '{"email":"new@example.com"}',
      outcome: "SUCCESS",
    };
    const { pool, calls } = fakePool({}, [
      [/COUNT_BIG\(\*\)/, [{ total_count: "25" }]],
      [/OFFSET @offset ROWS FETCH NEXT @page_size ROWS ONLY/, [auditRow]],
    ]);

    const result = await AuditTrailModel.getAuditTrail(pool, {
      page: 2,
      pageSize: 20,
      search: "user",
      status: "SUCCESS",
      from: "2026-10-01",
      to: "2026-10-27",
    });

    assert.deepEqual(result, { rows: [auditRow], total: 25 });
    assert.equal(calls.length, 2);
    assert.match(calls[1].query, /ORDER BY a\.us07_executed_at DESC, a\.us07_audit_log_id DESC/);
    assert.equal(calls[1].inputs.search, "%user%");
    assert.equal(calls[1].inputs.status, "SUCCESS");
    assert.equal(calls[1].inputs.offset, "20");
    assert.equal(calls[1].inputs.page_size, 20);
    assert.equal(calls[1].inputs.from_date.toISOString(), "2026-10-01T00:00:00.000Z");
    assert.equal(calls[1].inputs.to_date.toISOString(), "2026-10-27T00:00:00.000Z");
  });

  test("returns an empty result without losing the total when the page has no rows", async () => {
    const { pool } = fakePool({}, [
      [/COUNT_BIG\(\*\)/, [{ total_count: "0" }]],
      [/OFFSET @offset ROWS FETCH NEXT @page_size ROWS ONLY/, []],
    ]);

    assert.deepEqual(
      await AuditTrailModel.getAuditTrail(pool, {
        page: 1,
        pageSize: 20,
        search: null,
        status: null,
        from: null,
        to: null,
      }),
      { rows: [], total: 0 },
    );
  });

  test("the failed-outcome filter returns no rows because only committed changes are audited", async () => {
    const { pool, calls } = fakePool({}, [
      [/COUNT_BIG\(\*\)/, [{ total_count: "0" }]],
      [/OFFSET @offset ROWS FETCH NEXT @page_size ROWS ONLY/, []],
    ]);

    const result = await AuditTrailModel.getAuditTrail(pool, {
      page: 1,
      pageSize: 20,
      search: null,
      status: "FAILED",
      from: null,
      to: null,
    });

    assert.deepEqual(result, { rows: [], total: 0 });
    assert.match(calls[0].query, /@status IS NULL OR @status = 'SUCCESS'/);
    assert.equal(calls[0].inputs.status, "FAILED");
  });
});

describe("AuditTrailModel.getAuditIdsAfter", () => {
  test("returns every ID after the cursor without a result limit", async () => {
    const { pool, calls } = fakePool({}, [
      [/WHERE us07_audit_log_id > @after_audit_id/, [
        { audit_id: "2" },
        { audit_id: "3" },
      ]],
    ]);

    assert.deepEqual(await AuditTrailModel.getAuditIdsAfter(pool, "1"), ["2", "3"]);
    assert.equal(calls[0].inputs.after_audit_id, "1");
    assert.doesNotMatch(calls[0].query, /TOP\s*\(/i);
  });
});
