import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { ageAtEvent, computedOf, coverageOf, factsOf, insuredOf } from "../../src/claims/computed.js";

// Every date is fixed: nothing here reads a clock.

describe("ageAtEvent", () => {
  test("counts whole years and is birthday-aware", () => {
    assert.equal(ageAtEvent("1991-03-14", "2026-03-13"), 34, "the day before the birthday");
    assert.equal(ageAtEvent("1991-03-14", "2026-03-14"), 35, "on the birthday");
    assert.equal(ageAtEvent("1991-03-14", "2026-03-15"), 35);
    assert.equal(ageAtEvent("1991-03-14", "2026-12-31"), 35);
    assert.equal(ageAtEvent("1991-03-14", "2026-01-01"), 34, "earlier in the year than the birthday month");
  });

  test("a birthday on the 29th of February comes on the 1st of March in other years", () => {
    assert.equal(ageAtEvent("2000-02-29", "2026-02-28"), 25);
    assert.equal(ageAtEvent("2000-02-29", "2026-03-01"), 26);
    assert.equal(ageAtEvent("2000-02-29", "2028-02-29"), 28);
  });

  test("is null when a date is missing or is not one", () => {
    for (const [born, event] of [[null, "2026-03-14"], ["1991-03-14", undefined], ["", ""], ["March", "2026-03-14"]])
      assert.equal(ageAtEvent(born, event), null, `${born} ${event}`);
  });
});

const base = { birthdate: "1991-03-14", eventDate: "2026-10-02", effectiveDate: "2026-01-05", filedOn: "2026-11-04" };

describe("computedOf", () => {
  test("a claim after nine months of membership", () => {
    // 2026-01-05 to 2026-10-02 is 270 days: 0.739 years.
    assert.deepEqual(computedOf(base), {
      age_at_event: 35,
      years_of_membership: 0.7,
      membership_band: "LESS_THAN_2",
      contestability: "CONTESTABLE",
      event_year: 2026,
      filed_year: 2026,
      filed_month: "November",
      event_before_coverage: false,
    });
  });

  test("years are days over 365.25, to one decimal", () => {
    const years = (eventDate, effectiveDate) => computedOf({ ...base, eventDate, effectiveDate }).years_of_membership;

    assert.equal(years("2026-01-05", "2026-01-05"), 0, "the day coverage began");
    assert.equal(years("2026-07-05", "2026-01-05"), 0.5); // 181 days
    assert.equal(years("2025-01-01", "2024-01-01"), 1); // 366 days, 1.002
    assert.equal(years("2027-01-01", "2024-01-01"), 3); // 1096 days, 3.001
  });

  test("CONTESTABLE under one year, INCONTESTABLE from then on", () => {
    const contestability = (eventDate, effectiveDate) => computedOf({ ...base, eventDate, effectiveDate }).contestability;

    assert.equal(contestability("2026-01-05", "2026-01-05"), "CONTESTABLE");
    assert.equal(contestability("2025-01-01", "2024-01-01"), "INCONTESTABLE", "366 days");
    // 365 days is 0.9993 years on the contract's 365.25: still under a year.
    assert.equal(contestability("2026-01-01", "2025-01-01"), "CONTESTABLE", "365 days");
    assert.equal(contestability("2027-06-01", "2026-01-05"), "INCONTESTABLE");
  });

  // The decision is taken on the exact length, not the rounded figure shown beside it.
  test("the band and contestability are decided on the unrounded years", () => {
    // 365 days is 0.9993 years: shown as 1, and still under a year.
    const almostOne = computedOf({ ...base, eventDate: "2026-01-01", effectiveDate: "2025-01-01" });
    assert.equal(almostOne.years_of_membership, 1);
    assert.equal(almostOne.contestability, "CONTESTABLE");

    // 730 days is 1.9986 years: shown as 2, and still under two.
    const almostTwo = computedOf({ ...base, eventDate: "2025-12-31", effectiveDate: "2024-01-01" });
    assert.equal(almostTwo.years_of_membership, 2);
    assert.equal(almostTwo.membership_band, "LESS_THAN_2");
  });

  test("the bands", () => {
    const band = (eventDate, effectiveDate) => computedOf({ ...base, eventDate, effectiveDate }).membership_band;

    assert.equal(band("2026-01-05", "2026-01-05"), "LESS_THAN_2");
    assert.equal(band("2026-01-01", "2024-01-01"), "2_TO_LESS_THAN_3"); // 731 days
    assert.equal(band("2026-12-31", "2024-01-01"), "2_TO_LESS_THAN_3"); // 1095 days, 2.998
    assert.equal(band("2027-01-01", "2024-01-01"), "3_OR_MORE"); // 1096 days
    assert.equal(band("2036-01-01", "2024-01-01"), "3_OR_MORE");
  });

  // The claim is still recorded; the claims web app decides what it means.
  test("an event before the coverage began has no length of membership", () => {
    const result = computedOf({ ...base, eventDate: "2025-12-01" });

    assert.equal(result.event_before_coverage, true);
    assert.equal(result.years_of_membership, null);
    assert.equal(result.membership_band, null);
    assert.equal(result.contestability, null);
    assert.equal(result.age_at_event, 34, "the rest is still worked out");
    assert.equal(result.event_year, 2025);
  });

  test("an event on the day coverage began is not before it", () => {
    assert.equal(computedOf({ ...base, eventDate: "2026-01-05" }).event_before_coverage, false);
  });

  test("a missing date leaves what depends on it null, and is not 'before coverage'", () => {
    const noEffective = computedOf({ ...base, effectiveDate: null });
    assert.deepEqual(
      [noEffective.years_of_membership, noEffective.membership_band, noEffective.contestability, noEffective.event_before_coverage],
      [null, null, null, false],
    );

    const noBirthdate = computedOf({ ...base, birthdate: undefined });
    assert.equal(noBirthdate.age_at_event, null);
    assert.equal(noBirthdate.years_of_membership, 0.7);

    const noEvent = computedOf({ ...base, eventDate: undefined });
    assert.equal(noEvent.event_year, null);
    assert.equal(noEvent.years_of_membership, null);

    const noFiling = computedOf({ ...base, filedOn: undefined });
    assert.deepEqual([noFiling.filed_year, noFiling.filed_month], [null, null]);
  });

  test("the month of filing is named in English", () => {
    const month = (filedOn) => computedOf({ ...base, filedOn }).filed_month;

    assert.equal(month("2026-01-31"), "January");
    assert.equal(month("2026-12-01"), "December");
  });
});

const ENROLLMENT = {
  client_id: "501",
  enrollment_id: "9100",
  first_name: "Maria",
  middle_name: "Reyes",
  last_name: "Santos",
  suffix: "",
  birthdate: "1991-03-14",
  gender: "F",
  company_code: "ACM",
  company_name: "Acme Holdings Inc.",
  policy_no: "G-TLI-26-177",
  classification_desc: "Rank and file",
  enrollment_date: new Date(2026, 8, 22, 13, 18),
  // Columns that belong to the employee and not to a claim.
  tin_id: "123-456-789",
  contact_no: "09171234567",
  full_address: "27 Mabini St",
  email_address: "maria@example.com",
};

describe("insuredOf", () => {
  test("is the snapshot the contract lists, and nothing else of the enrollment", () => {
    assert.deepEqual(insuredOf(ENROLLMENT), {
      client_id: "501",
      enrollment_id: "9100",
      full_name: "Maria Reyes Santos",
      birthdate: "1991-03-14",
      gender: "F",
      company_code: "ACM",
      company_name: "Acme Holdings Inc.",
      policy_no: "G-TLI-26-177",
      classification: "Rank and file",
      effective_date: "2026-09-22",
    });
  });

  test("ids are text, however the driver sent them", () => {
    const insured = insuredOf({ ...ENROLLMENT, client_id: 501, enrollment_id: 9100n });

    assert.deepEqual([insured.client_id, insured.enrollment_id], ["501", "9100"]);
  });

  // The date of coverage is the enrollment's datetime read in Philippine time (certificateService).
  test("the effective date is the enrollment's date, as a day", () => {
    assert.equal(insuredOf({ ...ENROLLMENT, enrollment_date: new Date(2026, 0, 5, 23, 59) }).effective_date, "2026-01-05");
    assert.equal(insuredOf({ ...ENROLLMENT, enrollment_date: "2026-01-05" }).effective_date, "2026-01-05");
    assert.equal(insuredOf({ ...ENROLLMENT, enrollment_date: null }).effective_date, null);
  });

  test("a column the procedure does not return is null, not undefined", () => {
    const { company_code, classification_desc, gender, ...without } = ENROLLMENT;
    const insured = insuredOf(without);

    assert.deepEqual([insured.company_code, insured.classification, insured.gender], [null, null, null]);
    assert.ok(Object.values(insured).every((value) => value !== undefined));
  });
});

describe("coverageOf", () => {
  test("names a benefit's code, description, amount and formula", () => {
    assert.deepEqual(
      coverageOf([
        { benefit_name: "GTLIP", benefit_description: "Group Term Life Insurance Plan", coverage_amount: 500000, coverage_formula: null, other: 1 },
        { benefit_name: "GTIR", benefit_description: "Group Terminal Illness Rider", coverage_amount: null, coverage_formula: "50% OF GTLIP" },
      ]),
      [
        { code: "GTLIP", description: "Group Term Life Insurance Plan", amount: 500000, formula: null },
        { code: "GTIR", description: "Group Terminal Illness Rider", amount: null, formula: "50% OF GTLIP" },
      ],
    );
  });

  test("an amount that arrives as text is a number, and zero is an amount", () => {
    const [text, zero] = coverageOf([
      { benefit_name: "A", coverage_amount: "55000.00" },
      { benefit_name: "B", coverage_amount: 0 },
    ]);

    assert.equal(text.amount, 55000);
    assert.equal(zero.amount, 0);
  });

  test("no benefits is an empty list", () => {
    assert.deepEqual(coverageOf([]), []);
  });
});

describe("factsOf", () => {
  test("puts the three together from the details, the enrollment and the benefits", () => {
    const facts = factsOf({
      details: { event: { date: "2026-10-02" } },
      enrollment: { ...ENROLLMENT, enrollment_date: new Date(2026, 0, 5, 9, 0) },
      benefits: [{ benefit_name: "GTLIP", benefit_description: "Group Term Life", coverage_amount: 500000, coverage_formula: null }],
      filedOn: "2026-11-04",
    });

    assert.deepEqual(Object.keys(facts), ["insured", "computed", "coverage"]);
    assert.equal(facts.insured.effective_date, "2026-01-05");
    assert.equal(facts.computed.age_at_event, 35);
    assert.equal(facts.computed.years_of_membership, 0.7);
    assert.equal(facts.computed.filed_month, "November");
    assert.equal(facts.coverage[0].code, "GTLIP");
  });
});
