import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";
import { callTo, declarationOf, fakePool } from "../helpers/fakePool.js";
import { makeNext, makeReq, makeRes } from "../helpers/http.js";

const { createGetIpsEnrollees, ipsEnrolleeOf, ipsPageOf, MAX_IPS_PAGE } = await import("../../src/controllers/ipsController.js");
const { default: IpsModel } = await import("../../src/models/ipsModel.js");
const { sqlErrorMap } = await import("../../src/utils/sqlErrorMap.js");

// GET /api/v1/integration/ips/companies/:employer_id/enrollees, DBA request 33
// (md/IPS-INTEGRATION-DECISIONS.md, branch 2).

const PROC = "bes.usp_sel_ips_enrollees";

const person = (clientId, enrollmentId, overrides = {}) => ({
  enrollment_id: enrollmentId,
  client_id: clientId,
  employee_id_number: `EMP-${clientId}`,
  policy_no: `G-TLI-26-150-26000${clientId}`,
  group_policy_no: "G-TLI-26-150",
  first_name: "Ana",
  middle_name: null,
  last_name: "Reyes",
  suffix: null,
  birthdate: "1990-05-01",
  birthplace: "Manila",
  nationality: "Filipino",
  tin_id: "123-456-789",
  civil_status: "Single",
  gender: "F",
  height: 160,
  weight: 55,
  sss_gsis_no: "34-1234567-8",
  contact_no: "09171234567",
  email_address: "ana@abcc.example",
  occupation: "Clerk",
  source_of_income: "Salary",
  full_address: "1 Rizal St.",
  brgy_name: "Barangay 1",
  city_municipality_name: "Manila",
  province_name: "NCR, First District",
  region_name: "NCR",
  zip_code: "1000",
  employer_id: "5",
  company_code: "ABCC",
  company_name: "Abacus Book and Card Corporation",
  position_title: "Clerk",
  affiliate_id: "7",
  affiliate_code: "ALAKOR",
  affiliate_name: "Alakor Corporation",
  classification_id: "54",
  classification_code: "CLASS 4",
  classification_desc: "Rank and file",
  enrollment_date: "2026-11-01",
  status: "A",
  date_of_death: null,
  ...overrides,
});

const PAGE = {
  people: [person("101", "201"), person("102", "202", { affiliate_id: null })],
  benefits: [
    { enrollment_id: "201", enrollment_benefit_id: "1", classification_benefit_id: "9", benefit_type: "PLAN", benefit_name: "GTLIP", benefit_description: "Group Term Life", coverage_amount: 500000, coverage_formula: null },
    { enrollment_id: "201", enrollment_benefit_id: "2", classification_benefit_id: "10", benefit_type: "RIDER", benefit_name: "ADD", benefit_description: "Accidental Death", coverage_amount: 500000, coverage_formula: null },
  ],
  beneficiaries: [{ enrollment_id: "202", beneficiary_id: "31", full_name: "Jose Reyes", relationship: "Father", age: 60, coverage_percent: 100 }],
  hasMore: true,
};

const answered = async (req, page = PAGE) => {
  const reads = [];
  const res = makeRes();
  res.locals = {};
  const next = makeNext();

  await createGetIpsEnrollees({
    poolOf: async () => "pool",
    read: async (pool, input) => (reads.push({ pool, input }), page),
  })(makeReq({ params: { employer_id: "5" }, ...req }), res, next);

  return { reads, res, next };
};

describe("ipsPageOf: ?after=&limit=", () => {
  test("nothing given is the first page of 100", () => {
    assert.deepEqual(ipsPageOf({}), { after: null, limit: 100 });
    assert.equal(MAX_IPS_PAGE, 100);
  });

  test("after is a client id; limit is held to 1–100", () => {
    assert.deepEqual(ipsPageOf({ after: "102", limit: "50" }), { after: "102", limit: 50 });
    assert.equal(ipsPageOf({ limit: "500" }).limit, 100);
    for (const limit of ["0", "-3", "x"]) assert.equal(ipsPageOf({ limit }).limit, 100, limit);
  });

  test("an after that cannot be a client id is 400: a wrong guess would skip people", () => {
    for (const after of ["abc", "1.5", "-1", ["101"], "9".repeat(19)])
      assert.throws(() => ipsPageOf({ after }), { statusCode: 400 }, JSON.stringify(after));
  });
});

describe("GET …/companies/:employer_id/enrollees", () => {
  test("reads one page for the company, after the client id given", async () => {
    const { reads } = await answered({ query: { after: "100", limit: "2" } });

    assert.deepEqual(reads, [{ pool: "pool", input: { employerId: "5", afterClientId: "100", limit: 2 } }]);
  });

  test("each enrollee carries their benefits and beneficiaries, matched by enrollment", async () => {
    const { res } = await answered({});
    const [first, second] = res.body.data.rows;

    assert.deepEqual(first.benefits.map((b) => b.benefit_type), ["PLAN", "RIDER"]);
    assert.deepEqual(first.beneficiaries, []);
    assert.deepEqual(second.benefits, []);
    assert.deepEqual(second.beneficiaries, [{ beneficiary_id: "31", full_name: "Jose Reyes", relationship: "Father", age: 60, coverage_percent: 100 }]);
  });

  test("next_after is the last client id when more follow, and null on the last page", async () => {
    assert.equal((await answered({})).res.body.data.next_after, "102");
    assert.equal((await answered({}, { ...PAGE, hasMore: false })).res.body.data.next_after, null);
    assert.equal((await answered({}, { people: [], benefits: [], beneficiaries: [], hasMore: true })).res.body.data.next_after, null);
  });

  test("as_of says when the page was read, and the row count goes to the call log", async () => {
    const { res } = await answered({});

    assert.match(res.body.data.as_of, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.equal(res.locals.ipsRows, 2);
    assert.equal(res.statusCode, 200);
  });

  test("a company id that cannot be one is 404 before the database is asked", async () => {
    const { reads, next } = await answered({ params: { employer_id: "abc" } });

    assert.equal(reads.length, 0);
    assert.deepEqual(next.refusal(), { statusCode: 404, message: "Company not found" });
  });

  test("an unknown company (50187) goes to the error handler, as a 404", async () => {
    const refused = Object.assign(new Error("Company not found."), { number: 50187 });
    const next = makeNext();

    await createGetIpsEnrollees({ poolOf: async () => "pool", read: async () => Promise.reject(refused) })(
      makeReq({ params: { employer_id: "999" } }),
      Object.assign(makeRes(), { locals: {} }),
      next,
    );

    assert.deepEqual(next.calls, [refused]);
    assert.equal(sqlErrorMap[50187].statusCode, 404);
  });
});

describe("ipsEnrolleeOf: what IPS gets", () => {
  test("the person, grouped address, company, affiliate and class, and nothing the procedure adds later", () => {
    const shown = ipsEnrolleeOf({ ...person("101", "201"), signature_path: "C:\\files\\sig.png", created_by: "9" });

    assert.equal(shown.signature_path, undefined);
    assert.equal(shown.created_by, undefined);
    assert.deepEqual(shown.address, { full_address: "1 Rizal St.", barangay: "Barangay 1", city: "Manila", province: "NCR, First District", region: "NCR", zip_code: "1000" });
    assert.deepEqual(shown.company, { employer_id: "5", company_code: "ABCC", company_name: "Abacus Book and Card Corporation" });
    assert.deepEqual(shown.affiliate, { affiliate_id: "7", affiliate_code: "ALAKOR", affiliate_name: "Alakor Corporation" });
    assert.deepEqual(shown.classification, { classification_id: "54", classification_code: "CLASS 4", classification_desc: "Rank and file" });
    assert.equal(shown.employee_id_number, "EMP-101");
    assert.equal(shown.tin_id, "123-456-789");
    assert.equal(shown.birthdate, "1990-05-01");
  });

  test("the company's own employee has no affiliate; a deceased one carries the date", () => {
    assert.equal(ipsEnrolleeOf(person("102", "202", { affiliate_id: null })).affiliate, null);
    assert.equal(ipsEnrolleeOf(person("103", "203", { date_of_death: "2026-10-30" })).date_of_death, "2026-10-30");
  });
});

describe("IpsModel.getEnrollees", () => {
  test("one call, with the company, the cursor and the limit, and the four result sets read in order", async () => {
    const { pool, calls } = fakePool({
      [PROC]: () => ({
        recordsets: [[person("101", "201")], [PAGE.benefits[0]], [PAGE.beneficiaries[0]], [{ has_more: true }]],
        output: {},
      }),
    });

    const page = await IpsModel.getEnrollees(pool, { employerId: "5", afterClientId: null, limit: 100 });

    const call = callTo(calls, PROC);
    assert.deepEqual(call.inputs, { employer_id: "5", after_client_id: null, limit: 100 });
    assert.equal(declarationOf(call.bindings.after_client_id.type), "bigint");
    assert.equal(page.people[0].client_id, "101");
    assert.equal(page.benefits[0].benefit_type, "PLAN", "the second result set is the benefits");
    assert.equal(page.beneficiaries[0].full_name, "Jose Reyes", "the third is the beneficiaries");
    assert.equal(page.hasMore, true);
  });

  test("has_more false, or missing, is false", async () => {
    for (const more of [[{ has_more: false }], []]) {
      const { pool } = fakePool({ [PROC]: () => ({ recordsets: [[], [], [], more], output: {} }) });

      assert.equal((await IpsModel.getEnrollees(pool, { employerId: "5", limit: 100 })).hasMore, false);
    }
  });
});
