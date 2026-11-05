import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";
import { AppError } from "../../src/utils/AppError.js";
import {
  bookedCompanies,
  bookedCompanyOf,
  forgetBookedCompanies,
  loadBookedCompanies,
  markSetUp,
} from "../../src/integrations/bookedCompanies.js";

const { createGetBookedCompanies } = await import("../../src/controllers/bookedCompanyController.js");
const { default: adminRoutes } = await import("../../src/routes/adminRoutes.js");

// A record of the other system with only what matters here, and the contact people the tab must not pass on.
const application = (overrides = {}) => ({
  application_id: 1375,
  group_name: "  BLOOM WITH LOOMS LOGISTIC, INC. ",
  policy_no: "G-CBP-14-045",
  policy_number: null,
  effective_date: "2014-06-17T00:00:00.000Z",
  business_address: " 12 Mabini St., Pasig City ",
  business_nature: { id: 3, name: "Logistics", sub_nature: {} },
  number_of_lives: 240,
  email: "contact@bloom.example",
  contact_person: { full_name: "Somebody" },
  ...overrides,
});

describe("bookedCompanyOf", () => {
  test("keeps what identifies the company and its policy, trimmed, and nothing else", () => {
    assert.deepEqual(bookedCompanyOf(application()), {
      application_id: "1375",
      company_name: "BLOOM WITH LOOMS LOGISTIC, INC.",
      policy_no: "G-CBP-14-045",
      plan_template: "G-CBP",
      plan: "Group Comprehensive Benefits",
      effective_date: "2014-06-17",
      business_address: "12 Mabini St., Pasig City",
      business_nature: "Logistics",
      number_of_lives: 240,
    });
  });

  test("reads the plan from the front of the policy number", () => {
    for (const [policy, plan] of [["G-TLI-14-052", "Group Term Life"], ["G-CLI-22-503", "Group Credit Life"], ["G-ADD-14-054", "Group Accidental Death and Disability"], ["G-XYZ-1-1", null]])
      assert.equal(bookedCompanyOf(application({ policy_no: policy })).plan, plan, policy);
  });

  test("a record with no policy number, or none that reads, has no plan", () => {
    for (const policy of [null, "", "  ", "not a policy", "TLI-14-052"]) {
      const company = bookedCompanyOf(application({ policy_no: policy }));

      assert.equal(company.plan, null, String(policy));
      assert.equal(company.plan_template, null);
    }
  });

  test("falls back to policy_number when policy_no is empty", () => {
    assert.equal(bookedCompanyOf(application({ policy_no: null, policy_number: "G-TLI-26-001" })).policy_no, "G-TLI-26-001");
  });

  test("an empty or missing detail is null, a number of lives that is not a number too", () => {
    const company = bookedCompanyOf(application({ effective_date: null, business_address: "", business_nature: null, number_of_lives: null }));

    assert.equal(company.effective_date, null);
    assert.equal(company.business_address, null);
    assert.equal(company.business_nature, null);
    assert.equal(company.number_of_lives, null);
    assert.equal(bookedCompanyOf(application({ number_of_lives: "232" })).number_of_lives, null);
  });

  test("a record with no company name or no id is dropped", () => {
    for (const bad of [{ group_name: "" }, { group_name: "   " }, { group_name: null }, { application_id: null }, { application_id: undefined }])
      assert.equal(bookedCompanyOf(application(bad)), null, JSON.stringify(bad));
    assert.equal(bookedCompanyOf(null), null);
  });

  test("passes none of the contact details on", () => {
    const text = JSON.stringify(bookedCompanyOf(application()));

    assert.equal(/contact|email|somebody/i.test(text), false);
  });
});

describe("loadBookedCompanies", () => {
  const pagesOf = (...pages) => async ({ page, limit }) => {
    assert.equal(limit, 100, "asks for the 100 the other system pages by");
    return { success: true, data: pages[page - 1], pagination: { current_page: page, last_page: pages.length } };
  };

  test("reads every page and keeps the companies by name and then policy number", async () => {
    const companies = await loadBookedCompanies({
      fetchPage: pagesOf(
        [application({ application_id: 3, group_name: "Zeta Corp", policy_no: "G-TLI-1-1" }), application({ application_id: 1, group_name: "alpha Inc", policy_no: "G-TLI-1-2" })],
        [application({ application_id: 2, group_name: "Alpha Inc", policy_no: "G-CLI-1-1" })],
      ),
    });

    assert.deepEqual(companies.map((entry) => [entry.company_name, entry.policy_no]), [["Alpha Inc", "G-CLI-1-1"], ["alpha Inc", "G-TLI-1-2"], ["Zeta Corp", "G-TLI-1-1"]]);
  });

  test("a record seen twice, or one that names no company, is kept once or dropped", async () => {
    const companies = await loadBookedCompanies({ fetchPage: pagesOf([application(), application(), application({ application_id: 9, group_name: "" })]) });

    assert.equal(companies.length, 1);
  });

  test("a list that does not say how many pages it has is one page", async () => {
    let calls = 0;
    const companies = await loadBookedCompanies({ fetchPage: async () => { calls++; return { data: [application()] }; } });

    assert.equal(companies.length, 1);
    assert.equal(calls, 1);
  });

  test("never asks for more than 50 pages", async () => {
    let calls = 0;
    await loadBookedCompanies({ fetchPage: async ({ page }) => { calls++; return { data: [application({ application_id: page })], pagination: { last_page: 100000 } }; } });

    assert.equal(calls, 50);
  });

  test("an answer that is not a list is 502, on the first page or a later one", async () => {
    for (const fetchPage of [async () => ({ data: "no" }), async () => ({}), async ({ page }) => (page === 1 ? { data: [], pagination: { last_page: 2 } } : { data: null })]) {
      await assert.rejects(loadBookedCompanies({ fetchPage }), (error) => error instanceof AppError && error.statusCode === 502);
    }
  });
});

describe("the list is kept for a few minutes", () => {
  beforeEach(forgetBookedCompanies);

  const loader = (companies = [{ application_id: "1" }]) => {
    const calls = [];
    return { calls, load: async () => { calls.push(1); return companies; } };
  };

  test("a second read within five minutes is not asked of the other system again", async () => {
    const { calls, load } = loader();
    let clock = 1000;

    const first = await bookedCompanies({ load, now: () => clock });
    clock += 4 * 60 * 1000;
    const second = await bookedCompanies({ load, now: () => clock });

    assert.equal(calls.length, 1);
    assert.equal(second, first);
  });

  test("after five minutes it is read again", async () => {
    const { calls, load } = loader();
    let clock = 1000;

    await bookedCompanies({ load, now: () => clock });
    clock += 5 * 60 * 1000 + 1;
    await bookedCompanies({ load, now: () => clock });

    assert.equal(calls.length, 2);
  });

  test("refresh reads it again at once", async () => {
    const { calls, load } = loader();

    await bookedCompanies({ load });
    await bookedCompanies({ load, refresh: true });

    assert.equal(calls.length, 2);
  });

  test("a list that could not be read is not kept, and the next read tries again", async () => {
    let attempt = 0;
    const load = async () => {
      attempt++;
      if (attempt === 1) throw new AppError("The other system could not be reached.", 502);
      return [{ application_id: "1" }];
    };

    await assert.rejects(bookedCompanies({ load }));
    assert.equal((await bookedCompanies({ load })).companies.length, 1);
  });
});

describe("markSetUp", () => {
  const booked = (company_name, policy_no) => ({ application_id: company_name + policy_no, company_name, policy_no });
  const bes = (employer_id, company_name, policy_no, company_code = "ACME") => ({ employer_id, company_code, company_name, policy_no });

  test("a booked record with a policy number is the BES company with that number, however it is written", () => {
    const [marked] = markSetUp([booked("Acme Holdings", "g-tli-26-177")], [bes(5, "Another Name", " G-TLI-26-177 ", "ANO")]);

    assert.deepEqual(marked.set_up, { employer_id: "5", company_code: "ANO", company_name: "Another Name" });
  });

  test("the same name with another policy number is not set up", () => {
    const [marked] = markSetUp([booked("Acme Holdings", "G-TLI-26-178")], [bes(5, "Acme Holdings", "G-TLI-26-177")]);

    assert.equal(marked.set_up, null);
  });

  test("a record with no policy number is matched by name, when exactly one BES company has it", () => {
    assert.deepEqual(markSetUp([booked("Acme  Holdings", null)], [bes(5, "ACME HOLDINGS", "G-TLI-26-177")])[0].set_up, { employer_id: "5", company_code: "ACME", company_name: "ACME HOLDINGS" });
    assert.equal(markSetUp([booked("Acme Holdings", null)], [bes(5, "Acme Holdings", "A"), bes(6, "Acme Holdings", "B")])[0].set_up, null, "two companies of that name: not guessed");
    assert.equal(markSetUp([booked("Acme Holdings", null)], [bes(5, "Other", "A")])[0].set_up, null);
  });

  test("keeps the record as it was and does not change the companies", () => {
    const companies = [bes(5, "Acme", "G-TLI-1-1")];
    const [marked] = markSetUp([booked("Acme", "G-TLI-1-1")], companies);

    assert.equal(marked.company_name, "Acme");
    assert.deepEqual(companies, [bes(5, "Acme", "G-TLI-1-1")]);
  });
});

describe("the Administrator's route for it", () => {
  const run = async (options, query = {}) => {
    let answer;
    const res = { status: (code) => ({ json: (body) => { answer = { code, body }; return answer; } }) };
    let failure;

    await createGetBookedCompanies(options)({ query, user: { user_id: 1 } }, res, (error) => { failure = error; });

    return { answer, failure };
  };

  const listed = { at: Date.parse("2026-11-05T01:00:00.000Z"), companies: [{ application_id: "1", company_name: "Acme", policy_no: "G-TLI-1-1" }] };

  test("without the other system set up it answers that, and asks nothing of it", async () => {
    let asked = false;
    const { answer } = await run({ configured: () => false, list: async () => { asked = true; return listed; } });

    assert.equal(answer.code, 200);
    assert.deepEqual(answer.body.data, { configured: false, fetched_at: null, companies: [] });
    assert.equal(asked, false);
  });

  test("answers the booked companies with the BES company each is, and when the list was read", async () => {
    const { answer } = await run({
      configured: () => true,
      list: async () => listed,
      poolOf: async () => ({}),
      companiesOf: async (pool, userId) => (userId === 1 ? [{ employer_id: 5, company_code: "ACME", company_name: "Acme", policy_no: "G-TLI-1-1" }] : []),
    });

    assert.equal(answer.body.data.configured, true);
    assert.equal(answer.body.data.fetched_at, "2026-11-05T01:00:00.000Z");
    assert.deepEqual(answer.body.data.companies[0].set_up, { employer_id: "5", company_code: "ACME", company_name: "Acme" });
  });

  test("?refresh=1 asks for a new list and anything else does not", async () => {
    const asked = [];
    const options = { configured: () => true, list: async ({ refresh }) => { asked.push(refresh); return listed; }, poolOf: async () => ({}), companiesOf: async () => [] };

    await run(options, { refresh: "1" });
    await run(options, {});
    await run(options, { refresh: "true" });

    assert.deepEqual(asked, [true, false, false]);
  });

  test("a failure of the other system goes to the error handler", async () => {
    const { failure } = await run({ configured: () => true, list: async () => { throw new AppError("The other system could not be reached.", 502); } });

    assert.equal(failure.statusCode, 502);
  });

  test("the route is declared before /companies/:employer_id, which would take booked for an id", () => {
    const paths = adminRoutes.stack.filter((layer) => layer.route?.methods.get).map((layer) => layer.route.path);

    assert.ok(paths.includes("/companies/booked"));
    assert.ok(paths.indexOf("/companies/booked") < paths.indexOf("/companies/:employer_id"));
  });
});
