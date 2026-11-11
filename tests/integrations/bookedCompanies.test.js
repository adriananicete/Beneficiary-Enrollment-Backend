import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";
// GIS dates are read as the day they are in the Philippines, in this process's
// time zone. Set here as the server sets it, so the expectations below do not
// depend on the machine the tests run on.
import "../../src/config/timezone.js";
import { AppError } from "../../src/utils/AppError.js";
import {
  bookedCompanies,
  bookedCompanyOf,
  forgetBookedCompanies,
  loadBookedCompanies,
  markSetUp,
  PAGES_AT_ONCE,
} from "../../src/integrations/bookedCompanies.js";

const { createGetBookedCompanies } = await import("../../src/controllers/bookedCompanyController.js");
const { default: adminRoutes } = await import("../../src/routes/adminRoutes.js");

// A record as the other system sends it, with only what matters here: a plan, and a contact person with an email only.
const application = (overrides = {}) => ({
  application_id: 1375,
  group_name: "  BLOOM WITH LOOMS LOGISTIC, INC. ",
  policy_no: "G-CBP-14-045",
  plan: { id: 2, name: "Group Comprehensive Benefits Plan (Retirement) (GCBPR)", acronym: "GCBPR" },
  effective_date: "2014-06-17T16:00:00.000Z",
  business_address: " 12 Mabini St., Pasig City ",
  business_nature: { name: "Logistics" },
  number_of_lives: 240,
  contact_person: { name: null, email: "contact@bloom.example", firstname: null, middlename: null, lastname: null },
  ...overrides,
});

describe("bookedCompanyOf", () => {
  test("keeps what a screen uses, trimmed, and nothing else", () => {
    assert.deepEqual(bookedCompanyOf(application()), {
      application_id: "1375",
      company_name: "BLOOM WITH LOOMS LOGISTIC, INC.",
      policy_no: "G-CBP-14-045",
      plan: "Group Comprehensive Benefits Plan (Retirement) (GCBPR)",
      // "2014-06-17T16:00:00.000Z" is midnight of the 18th in Manila.
      effective_date: "2014-06-18",
      expiry_date: "2015-06-18",
      business_address: "12 Mabini St., Pasig City",
      business_nature: "Logistics",
      number_of_lives: 240,
      maximum_age: null,
      phone: null,
      contact: { first_name: null, middle_name: null, last_name: null, email: "contact@bloom.example" },
    });
  });

  test("reads the age limit, the phone and the contact person once the record has them", () => {
    const company = bookedCompanyOf(
      application({
        maximum_age: 65,
        company_contact: { company_telephone: " 02-8123-4567 ", company_mobile: "0917 000 0000" },
        contact_person: { name: "Ms. Elena R Cruz", salutation: "Ms.", firstname: " Elena ", middlename: "R", lastname: "Cruz", email: "elena@bloom.example", designation: "HR Manager" },
      }),
    );

    assert.equal(company.maximum_age, 65);
    assert.equal(company.phone, "02-8123-4567");
    assert.deepEqual(company.contact, { first_name: "Elena", middle_name: "R", last_name: "Cruz", email: "elena@bloom.example" });
  });

  test("the mobile is the phone when there is no telephone", () => {
    const company = bookedCompanyOf(application({ company_contact: { company_telephone: null, company_mobile: "0917 000 0000" } }));

    assert.equal(company.phone, "0917 000 0000");
  });

  test("reads a record as the other system's sample shows it: middlename, a bare +63, the date in Manila", () => {
    const company = bookedCompanyOf({
      application_id: 1410,
      group_name: "Sample",
      policy_no: "G-TLI-26-206",
      product: { id: 2, name: "Group Term Life Insurance", acronym: "GYRT" },
      plan: { id: 2, name: "Group Term Life Insurance Plan (GYRTP)", acronym: "GYRTP" },
      status: { id: 7, name: "Booked" },
      effective_date: "2026-10-21T16:00:00.000Z",
      business_address: "Ayala Makati",
      company_contact: { contact_number: null, company_mobile: "+63", company_telephone: null },
      maximum_age: 65,
      number_of_lives: 201,
      business_nature: { name: "Manufacturing" },
      contact_person: { name: "Mr. Johns D Does", email: "johns@sample.example", salutation: "Mr.", firstname: "Johns", middlename: "D", lastname: "Does", designation: "HR Manager", contact_number: "+63" },
      borrower_age_66_70: null,
      borrower_age_71_75: null,
      borrower_age_76_80: null,
    });

    assert.equal(company.effective_date, "2026-10-22");
    assert.equal(company.phone, null, "+63 alone is no number");
    assert.equal(company.maximum_age, 65);
    assert.equal(company.plan, "Group Term Life Insurance Plan (GYRTP)");
    assert.deepEqual(company.contact, { first_name: "Johns", middle_name: "D", last_name: "Does", email: "johns@sample.example" });
  });

  // GIS stores Philippine midnight and sends it in UTC. Read on GIS UAT
  // 2026-11-11: ABCC's policy, effective August 1, 2026 by its contract, reads
  // "2026-07-31T16:00:00.000Z". The teammates kept the first ten characters,
  // which is a day early.
  test("the effective date is the day it is in Manila, and is nothing when it is not a date", () => {
    const dateOf = (effective_date) => bookedCompanyOf(application({ effective_date })).effective_date;

    assert.equal(dateOf("2026-07-31T16:00:00.000Z"), "2026-08-01", "ABCC: August 1 by its contract");
    assert.equal(dateOf("2026-10-21T16:00:00.000Z"), "2026-10-22");
    assert.equal(dateOf("2026-10-22T15:59:59.999Z"), "2026-10-22", "the last instant of the 22nd in Manila");
    assert.equal(dateOf("2014-06-17T00:54:14.187Z"), "2014-06-17", "a time of day GIS sent three times");
    assert.equal(dateOf("2026-10-22"), "2026-10-22", "a bare date stays that date");
    assert.equal(dateOf(" 2026-07-31T16:00:00.000Z "), "2026-08-01", "trimmed, like the rest");
    for (const bad of ["tomorrow", "2026-13-45T00:00:00Z", "", "  ", null, undefined, 20261021, {}]) assert.equal(dateOf(bad), null, JSON.stringify(bad));
  });

  test("the policy expires one year after its effective date, and has no expiry without one", () => {
    const expiryOf = (effective_date) => bookedCompanyOf(application({ effective_date })).expiry_date;

    assert.equal(expiryOf("2026-07-31T16:00:00.000Z"), "2027-08-01", "ABCC: renews every August 1");
    assert.equal(expiryOf("2026-12-31T16:00:00.000Z"), "2028-01-01", "midnight of 1 January in Manila");
    assert.equal(expiryOf("2014-06-17"), "2015-06-17");
    assert.equal(expiryOf("2024-02-29"), "2025-02-28", "no 29 February in the next year");
    assert.equal(expiryOf("2027-02-28"), "2028-02-28", "28 February stays the 28th even before a leap year");
    assert.equal(expiryOf("2023-03-01"), "2024-03-01");
    for (const none of [null, undefined, "", "tomorrow", "2026-13-45T00:00:00Z"]) assert.equal(expiryOf(none), null, String(none));
  });

  test("a phone of only the country code is nothing, and the next field is tried", () => {
    const phoneOf = (company_contact) => bookedCompanyOf(application({ company_contact })).phone;

    assert.equal(phoneOf({ company_telephone: "+63", company_mobile: "+63" }), null);
    assert.equal(phoneOf({ company_telephone: "+63", company_mobile: "+63 917 123 4567" }), "+63 917 123 4567");
    assert.equal(phoneOf({ company_telephone: "8123 4567" }), "8123 4567");
  });

  test("the age limit is the highest senior bracket the company chose, else the maximum age the record states", () => {
    const flags = (on) => ({ borrower_age_66_70: on.includes(70), borrower_age_71_75: on.includes(75), borrower_age_76_80: on.includes(80) });

    assert.equal(bookedCompanyOf(application({ maximum_age: 65, ...flags([]) })).maximum_age, 65, "the standard");
    assert.equal(bookedCompanyOf(application({ maximum_age: 65, ...flags([70]) })).maximum_age, 70);
    assert.equal(bookedCompanyOf(application({ maximum_age: 65, ...flags([70, 75]) })).maximum_age, 75, "the highest chosen wins");
    assert.equal(bookedCompanyOf(application({ maximum_age: 65, ...flags([70, 75, 80]) })).maximum_age, 80);
    assert.equal(bookedCompanyOf(application({ maximum_age: null, ...flags([75]) })).maximum_age, 75, "a bracket alone is enough");
    assert.equal(bookedCompanyOf(application({ maximum_age: null, ...flags([]) })).maximum_age, null, "nothing said is nothing guessed");
    assert.equal(bookedCompanyOf(application({ maximum_age: 65, borrower_age_66_70: "true" })).maximum_age, 65, "only a real true counts");
  });

  test("an age that is not a whole number, and a phone that is not text, are nothing", () => {
    const company = bookedCompanyOf(application({ maximum_age: "65", company_contact: { company_telephone: 28123456 } }));

    assert.equal(company.maximum_age, null);
    assert.equal(company.phone, null);
  });

  test("a record whose contact person is all empty, or missing, has no contact", () => {
    const empty = { name: null, email: null, salutation: null, firstname: null, middlename: null, lastname: null, designation: null, contact_number: null };

    assert.equal(bookedCompanyOf(application({ contact_person: empty })).contact, null);
    assert.equal(bookedCompanyOf(application({ contact_person: { ...empty, email: "  " } })).contact, null);
    assert.equal(bookedCompanyOf(application({ contact_person: null })).contact, null);
  });

  test("the plan is the name the other system gives it, with or without a policy number", () => {
    const planOf = (overrides) => bookedCompanyOf(application(overrides)).plan;

    assert.equal(planOf({ plan: { name: "  Students Group Personal Accident Plan (STUD GPAI) " } }), "Students Group Personal Accident Plan (STUD GPAI)");
    assert.equal(planOf({ policy_no: null, plan: { name: "Students Group Term Life Plan (STUD GTLIP)" } }), "Students Group Term Life Plan (STUD GTLIP)");
    assert.equal(planOf({ policy_no: "G-TMR-26-001", plan: { name: "Group Term Life Insurance Plan (GYRTP)" } }), "Group Term Life Insurance Plan (GYRTP)", "whatever the policy number begins with");
  });

  test("a record with no plan, or a plan with no name, has no plan", () => {
    for (const plan of [undefined, null, {}, { id: null, name: null, acronym: null }, { name: "  " }, "GYRTP"])
      assert.equal(bookedCompanyOf(application({ plan })).plan, null, JSON.stringify(plan));
  });

  test("a record with no policy number has none, and is not given another field's", () => {
    for (const policy_no of [null, undefined, "", "  "]) assert.equal(bookedCompanyOf(application({ policy_no, policy_number: "G-TLI-26-001" })).policy_no, null, String(policy_no));
  });

  test("an empty or missing detail is null, a number of lives that is not a number too", () => {
    const company = bookedCompanyOf(application({ effective_date: null, business_address: "", business_nature: null, number_of_lives: null }));

    assert.equal(company.effective_date, null);
    assert.equal(company.expiry_date, null);
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

  test("passes on only the contact person's name and email, not the rest of what the other system holds", () => {
    const text = JSON.stringify(
      bookedCompanyOf(
        application({
          contact_person: { name: "Mr. Somebody Else", email: "contact@bloom.example", firstname: "Some", middlename: null, lastname: "Body", designation: "HR Manager", contact_number: "0917 111 1111" },
          coverage_type: { id: 32, name: "Level Ranking" },
          amount_of_loans: { loans_amount: 5000000 },
          creator_email: "staff@gis.example",
        }),
      ),
    );

    assert.equal(/mr\. somebody|hr manager|0917 111|level ranking|5000000|staff@gis/i.test(text), false);
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

  test("a renewal that comes as a new record under the same policy number replaces the old one, and only for the same company", async () => {
    const companies = await loadBookedCompanies({
      fetchPage: pagesOf([
        application({ application_id: 10, group_name: "Acme Inc", policy_no: "G-TLI-1-1", effective_date: "2025-01-01T00:00:00Z" }),
        application({ application_id: 30, group_name: "ACME  INC", policy_no: "g-tli-1-1", effective_date: "2026-01-01T00:00:00Z" }),
        application({ application_id: 20, group_name: "Acme Inc", policy_no: "G-TLI-1-1", effective_date: "2024-01-01T00:00:00Z" }),
        application({ application_id: 40, group_name: "Another Company", policy_no: "G-TLI-1-1", effective_date: "2025-06-01T00:00:00Z" }),
      ]),
    });

    assert.deepEqual(companies.map((company) => company.application_id), ["30", "40"], "the newest of Acme's, and the other company that shares the number");
  });

  test("with the same effective date the higher id is the newer, and a record with no policy number is never merged", async () => {
    const companies = await loadBookedCompanies({
      fetchPage: pagesOf([
        application({ application_id: 5, group_name: "Acme Inc", policy_no: "G-TLI-1-1", effective_date: "2026-01-01T00:00:00Z" }),
        application({ application_id: 6, group_name: "Acme Inc", policy_no: "G-TLI-1-1", effective_date: "2026-01-01T00:00:00Z" }),
        application({ application_id: 7, group_name: "Beta Inc", policy_no: null }),
        application({ application_id: 8, group_name: "Beta Inc", policy_no: null }),
      ]),
    });

    assert.deepEqual(companies.map((company) => company.application_id), ["6", "7", "8"]);
  });

  test("a list that does not say how many pages it has is one page", async () => {
    let calls = 0;
    const companies = await loadBookedCompanies({ fetchPage: async () => { calls++; return { data: [application()] }; } });

    assert.equal(companies.length, 1);
    assert.equal(calls, 1);
  });

  test("asks for the pages after the first together, not one after another", async () => {
    let running = 0;
    let most = 0;
    const companies = await loadBookedCompanies({
      fetchPage: async ({ page }) => {
        running++;
        most = Math.max(most, running);
        await new Promise((resolve) => setTimeout(resolve, 10));
        running--;

        return { data: [application({ application_id: page, group_name: `Company ${String(page).padStart(2, "0")}` })], pagination: { last_page: 4 } };
      },
    });

    assert.equal(most, 3, "pages 2, 3 and 4 at once");
    assert.deepEqual(companies.map((company) => company.application_id), ["1", "2", "3", "4"], "in page order whichever answers first");
  });

  // The teammates asked for every page at once, up to 49 requests together to a
  // system that is not ours. Now at most PAGES_AT_ONCE (4), and a later page
  // answering first still lands in its own place.
  test("asks for at most four pages at once, and keeps them in page order", async () => {
    let running = 0;
    let most = 0;
    const companies = await loadBookedCompanies({
      fetchPage: async ({ page }) => {
        running++;
        most = Math.max(most, running);
        // Later pages answer sooner, so the order cannot come from timing.
        await new Promise((resolve) => setTimeout(resolve, 40 - page * 3));
        running--;

        return { data: [application({ application_id: page, group_name: `Company ${String(page).padStart(2, "0")}` })], pagination: { last_page: 12 } };
      },
    });

    assert.equal(PAGES_AT_ONCE, 4);
    assert.equal(most, 4, "never more than four in flight");
    assert.equal(companies.length, 12);
    assert.deepEqual(
      companies.map((company) => company.application_id),
      Array.from({ length: 12 }, (_, index) => String(index + 1)),
    );
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

  test("a company's other policy is that company: the same name with a number no BES company holds is set up", () => {
    const company = bes(5, "1-PENTAGON CREDIT AND LENDING CORPORATION", "G-ADD-26-301", "1-PENTAGON");
    const [added, other] = markSetUp(
      [booked("1-PENTAGON CREDIT AND LENDING CORPORATION", "G-ADD-26-301"), booked("1-Pentagon  Credit and Lending Corporation", "G-CLI-20-505")],
      [company],
    );

    const expected = { employer_id: "5", company_code: "1-PENTAGON", company_name: "1-PENTAGON CREDIT AND LENDING CORPORATION" };
    assert.deepEqual(added.set_up, expected);
    assert.deepEqual(other.set_up, expected, "the second policy is not a company still to add");
  });

  test("a number a BES company holds is that company, whatever the name says, before the name is looked at", () => {
    const [marked] = markSetUp([booked("Acme Holdings", "G-TLI-26-177")], [bes(5, "Acme Holdings", "G-TLI-26-178", "ACME"), bes(6, "Another Name", "G-TLI-26-177", "ANO")]);

    assert.equal(marked.set_up.employer_id, "6");
  });

  test("a record is matched by name when it has no policy number, or its company has none, when exactly one BES company has the name", () => {
    assert.deepEqual(markSetUp([booked("Acme  Holdings", null)], [bes(5, "ACME HOLDINGS", "G-TLI-26-177")])[0].set_up, { employer_id: "5", company_code: "ACME", company_name: "ACME HOLDINGS" });
    assert.equal(markSetUp([booked("Acme Holdings", "G-TLI-26-177")], [bes(5, "Acme Holdings", null)])[0].set_up?.employer_id, "5", "the BES company was saved without a policy number");
    assert.equal(markSetUp([booked("Acme Holdings", null)], [bes(5, "Acme Holdings", "A"), bes(6, "Acme Holdings", "B")])[0].set_up, null, "two companies of that name: not guessed");
    assert.equal(markSetUp([booked("Acme Holdings", "G-TLI-26-177")], [bes(5, "Acme Holdings", "A"), bes(6, "Acme Holdings", "B")])[0].set_up, null, "nor with a number");
    assert.equal(markSetUp([booked("Acme Holdings", null)], [bes(5, "Other", "A")])[0].set_up, null);
    assert.equal(markSetUp([booked("Acme Holdings", "G-TLI-26-178")], [bes(5, "Other", "G-TLI-26-177")])[0].set_up, null, "another name and another number: not set up");
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

  test("the list carries no contact person, the answer for one company does", async () => {
    const withContact = {
      at: listed.at,
      companies: [
        { application_id: "1", company_name: "Acme", policy_no: "G-TLI-1-1", contact: { first_name: "Elena", middle_name: null, last_name: "Cruz", email: "elena@acme.example" } },
        { application_id: "2", company_name: "Beta", policy_no: "G-TLI-1-2", contact: { first_name: null, middle_name: null, last_name: null, email: "x@beta.example" } },
      ],
    };
    const options = {
      configured: () => true,
      list: async () => withContact,
      poolOf: async () => ({}),
      companiesOf: async () => [{ employer_id: 5, company_code: "ACME", company_name: "Acme", policy_no: "G-TLI-1-1" }],
    };

    const all = (await run(options)).answer.body.data.companies;
    assert.equal(all.length, 2);
    assert.equal(all.some((entry) => "contact" in entry), false);
    assert.equal(withContact.companies[0].contact.email, "elena@acme.example", "the kept list is not changed");

    const one = (await run(options, { employer_id: "5" })).answer.body.data.companies;
    assert.deepEqual(one.map((entry) => entry.application_id), ["1"]);
    assert.equal(one[0].contact.email, "elena@acme.example");

    assert.deepEqual((await run(options, { employer_id: "99" })).answer.body.data.companies, []);
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
