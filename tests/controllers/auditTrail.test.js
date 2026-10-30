import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";
import { makeNext, makeReq, makeRes } from "../helpers/http.js";

const { createGetAuditTrail } = await import(
  "../../src/controllers/auditTrailController.js"
);

const makeHandler = (model = { getAuditTrail: async () => ({ rows: [], total: 0 }) }) => {
  let poolReads = 0;
  const handler = createGetAuditTrail({
    getPool: async () => {
      poolReads += 1;
      return {};
    },
    model,
  });

  return { handler, poolReads: () => poolReads };
};

describe("GET /audit-trail controller", () => {
  test("returns the filtered page in the frontend's expected response shape", async () => {
    const row = {
      audit_id: "1",
      action: "UPDATE",
      outcome: "SUCCESS",
      old_values: '{"password":"old","status":"PENDING","document_name":"proof.pdf"}',
      new_values: '{"password":"new","status":"APPROVED","document_name":"proof.pdf"}',
    };
    let received;
    const { handler } = makeHandler({
      getAuditTrail: async (_pool, filters) => {
        received = filters;
        return { rows: [row], total: 1 };
      },
    });
    const req = makeReq({
      query: {
        page: "2",
        pageSize: "20",
        search: " account ",
        status: "SUCCESS",
        from: "2026-10-01",
        to: "2026-10-27",
      },
    });
    const res = makeRes();
    const next = makeNext();

    await handler(req, res, next);

    assert.equal(next.calls.length, 0);
    assert.deepEqual(received, {
      page: 2,
      pageSize: 20,
      search: "account",
      status: "SUCCESS",
      from: "2026-10-01",
      to: "2026-10-27",
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
      success: true,
      data: {
        rows: [{
          ...row,
          old_values: '{"password":"[REDACTED]","status":"PENDING","document_name":"[OMITTED]"}',
          new_values: '{"password":"[REDACTED]","status":"APPROVED","document_name":"[OMITTED]"}',
        }],
        page: 2,
        pageSize: 20,
        total: 1,
        totalPages: 1,
      },
    });
  });

  test("rejects malformed or reversed date filters before opening the database", async () => {
    const cases = [
      [{ from: "10/01/2026" }, "from must be a date in YYYY-MM-DD format"],
      [{ from: "2026-02-30" }, "from must be a valid date"],
      [{ from: "2026-10-02", to: "2026-10-01" }, "from must be on or before to"],
      [{ status: "UNKNOWN" }, "status must be SUCCESS or FAILED"],
    ];

    for (const [query, message] of cases) {
      const { handler, poolReads } = makeHandler();
      const next = makeNext();

      await handler(makeReq({ query }), makeRes(), next);

      assert.equal(next.refusal()?.statusCode, 400);
      assert.equal(next.refusal()?.message, message);
      assert.equal(poolReads(), 0);
    }
  });

  test("rejects searches longer than the database parameter before querying", async () => {
    const { handler, poolReads } = makeHandler();
    const next = makeNext();

    await handler(
      makeReq({ query: { search: "a".repeat(101) } }),
      makeRes(),
      next,
    );

    assert.deepEqual(next.refusal(), {
      statusCode: 400,
      message: "search must be 100 characters or fewer",
    });
    assert.equal(poolReads(), 0);
  });
});
