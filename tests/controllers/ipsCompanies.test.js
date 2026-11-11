import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";
import { makeNext, makeReq, makeRes } from "../helpers/http.js";
import { callTo, fakePool } from "../helpers/fakePool.js";

const { createGetIpsCompanies, ipsCompanyOf } = await import("../../src/controllers/ipsController.js");
const { getEmployers } = await import("../../src/models/referenceModel.js");
const { sql } = await import("../../src/config/db.js");

// GET /api/v1/integration/ips/companies (md/IPS-INTEGRATION-DECISIONS.md, branch 1).

const ROWS = [
  { employer_id: "1", company_code: "COFORGE", company_name: "Coforge", status: "A", work_address: "not for IPS" },
  { employer_id: "2", company_code: "HCL", company_name: "HCL", status: "I" },
];

const answered = async (deps) => {
  const res = makeRes();
  res.locals = {};
  const next = makeNext();

  await createGetIpsCompanies({ poolOf: async () => "pool", ...deps })(makeReq(), res, next);

  return { res, next };
};

describe("GET /integration/ips/companies", () => {
  test("every company, with only the four fields IPS gets", async () => {
    const { res, next } = await answered({ employersOf: async () => ROWS });

    assert.equal(next.calls.length, 0);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.deepEqual(res.body.data.rows, [
      { employer_id: "1", company_code: "COFORGE", company_name: "Coforge", status: "A" },
      { employer_id: "2", company_code: "HCL", company_name: "HCL", status: "I" },
    ]);
  });

  test("as_of is the time of the answer, in ISO form", async () => {
    const before = Date.now();
    const { res } = await answered({ employersOf: async () => ROWS });

    assert.match(res.body.data.as_of, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.ok(Date.parse(res.body.data.as_of) >= before);
  });

  test("the number of rows is left for the call log", async () => {
    const { res } = await answered({ employersOf: async () => ROWS });

    assert.equal(res.locals.ipsRows, 2);
  });

  test("a database failure goes to the error handler", async () => {
    const failure = new Error("connection lost");
    const { res, next } = await answered({
      employersOf: async () => {
        throw failure;
      },
    });

    assert.deepEqual(next.calls, [failure]);
    assert.equal(res.statusCode, null);
  });

  // Without a replacement for the read, the controller's own: inactive companies included.
  test("by default it reads every company, inactive ones included", async () => {
    const { pool, calls } = fakePool({ "bes.usp_sel_employers": ROWS });
    const { res } = await answered({ poolOf: async () => pool });

    assert.equal(callTo(calls, "bes.usp_sel_employers").inputs.include_inactive, true);
    assert.equal(res.body.data.rows.length, 2);
  });

  test("ipsCompanyOf drops anything not in the four", () => {
    assert.deepEqual(Object.keys(ipsCompanyOf(ROWS[0])), ["employer_id", "company_code", "company_name", "status"]);
  });
});

describe("ReferenceModel.getEmployers", () => {
  test("asks for inactive companies only when told to; the form and the dashboard keep the active ones", async () => {
    for (const [options, expected] of [
      [undefined, false],
      [{}, false],
      [{ includeInactive: true }, true],
    ]) {
      const { pool, calls } = fakePool({ "bes.usp_sel_employers": [] });
      await getEmployers(pool, options);

      const call = callTo(calls, "bes.usp_sel_employers");
      assert.equal(call.inputs.include_inactive, expected, JSON.stringify(options));
      assert.equal(call.bindings.include_inactive.type, sql.Bit);
    }
  });
});
