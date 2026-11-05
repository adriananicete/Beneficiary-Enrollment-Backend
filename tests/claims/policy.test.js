import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { LOSS_CODES, LOSS_EVENTS, assessClaim, policyFor } from "../../src/claims/policy.js";

// What the benefits of one employee pay, as the coverage kept with a claim lists them.
const COVERAGE = [
  { code: "GTLIP", description: "Group Term Life Insurance Plan", amount: 500000, formula: null },
  { code: "GTPDR", description: "Group Total and Permanent Disability Rider", amount: 500000, formula: null },
  { code: "GADDR", description: "Group Accidental Death and Disability Rider", amount: 500000, formula: null },
  { code: "ALCR", description: "Additional/Life Coverage", amount: 55000, formula: null },
  { code: "GTIR", description: "Group Terminal Illness Rider", amount: null, formula: "50% OF GTLIP" },
];

const INCONTESTABLE = { age_at_event: 35, contestability: "INCONTESTABLE", event_before_coverage: false };
const CONTESTABLE = { age_at_event: 35, contestability: "CONTESTABLE", event_before_coverage: false };

const assess = (profile, condition = {}, overrides = {}) =>
  assessClaim({
    profile,
    details: { event: { date: "2026-10-02" }, condition },
    coverage: COVERAGE,
    computed: INCONTESTABLE,
    insured: { company_code: null },
    filedOn: "2026-10-12",
    ...overrides,
  });

const lineOf = (assessment, key) => assessment.lines.find((entry) => entry.key === key);
const textsOf = (assessment, level) => assessment.checks.filter((check) => check.level === level).map((check) => check.text);

describe("the schedule of losses", () => {
  test("is the digest's Event of Loss: its codes, its order and its percentages", () => {
    const percent = Object.fromEntries(LOSS_EVENTS.map((event) => [event.code, event.percent]));

    assert.equal(LOSS_EVENTS.length, 27);
    assert.deepEqual(LOSS_CODES.slice(0, 3), ["TWO_LIMBS", "BOTH_HANDS", "BOTH_FEET"]);
    assert.equal(LOSS_CODES.at(-1), "OTHER", "a loss the schedule does not name comes last");
    assert.equal(new Set(LOSS_CODES).size, LOSS_CODES.length, "no code twice");

    for (const code of ["TWO_LIMBS", "BOTH_HANDS", "BOTH_FEET", "SIGHT_OF_BOTH_EYES", "BEDRIDDEN", "PERMANENT_TOTAL_DISABILITY"]) assert.equal(percent[code], 100, code);
    assert.deepEqual(
      [percent.ARM_ABOVE_ELBOW, percent.ARM_BELOW_ELBOW, percent.ONE_HAND, percent.FOUR_FINGERS_AND_THUMB, percent.FOUR_FINGERS, percent.THUMB],
      [70, 60, 50, 50, 35, 15],
    );
    assert.deepEqual([percent.INDEX_FINGER, percent.MIDDLE_FINGER, percent.RING_FINGER, percent.LITTLE_FINGER], [10, 6, 5, 4]);
    assert.deepEqual([percent.METACARPAL_1_2, percent.METACARPAL_3_5], [3, 2]);
    assert.deepEqual([percent.LEG_ABOVE_KNEE, percent.LEG_BELOW_KNEE, percent.ONE_FOOT, percent.ALL_TOES_OF_ONE_FOOT, percent.BIG_TOE, percent.OTHER_TOE], [60, 50, 50, 25, 5, 1]);
    assert.deepEqual([percent.SIGHT_OF_ONE_EYE, percent.HEARING_BOTH_EARS, percent.HEARING_ONE_EAR], [50, 50, 25]);
  });
});

describe("a company's terms", () => {
  test("Firstsource has its own burial amount, terminal illness cap and policy period", () => {
    const terms = policyFor("firstsource");

    assert.equal(terms.burial.amount, 10000);
    assert.equal(terms.terminal_illness.max, 4000000);
    assert.deepEqual(terms.period, { from: "2026-10-01", to: "2027-09-30" });
  });

  test("any other company, or none, has the standard terms", () => {
    for (const code of [null, undefined, "", "ACME", "constructor", "__proto__", 5]) {
      const terms = policyFor(code);

      assert.equal(terms.burial.amount, null, String(code));
      assert.equal(terms.period, null);
      assert.equal(terms.rider_age_limit, 66);
      assert.equal(terms.basic_age_limit, 71);
    }
  });
});

describe("a death claim", () => {
  test("pays the life benefit and the additional life coverage, and a natural death nothing more", () => {
    const result = assess("death", { manner_of_death: "NATURAL" });

    assert.deepEqual(result.lines.map((entry) => [entry.key, entry.amount]), [["life", 500000], ["additional_life", 55000]]);
    assert.equal(result.total, 555000);
    assert.equal(result.complete, true);
  });

  test("an accidental death pays the accidental death benefit as well", () => {
    const result = assess("death", { manner_of_death: "ACCIDENT" });

    assert.equal(lineOf(result, "accidental").amount, 500000);
    assert.equal(result.total, 1055000);
  });

  test("an accidental death with no accidental benefit enrolled says so and is not complete", () => {
    const result = assess("death", { manner_of_death: "ACCIDENT" }, { coverage: COVERAGE.filter((benefit) => benefit.code !== "GADDR") });

    assert.equal(lineOf(result, "accidental").amount, null);
    assert.match(lineOf(result, "accidental").basis, /no accidental death benefit is enrolled/i);
    assert.equal(result.complete, false);
    assert.equal(result.total, 555000, "the total is what can be worked out");
  });

  test("burial is paid whatever the cause, from the company's terms when the employee has no burial benefit", () => {
    const result = assess("death", { manner_of_death: "NATURAL" }, { insured: { company_code: "FIRSTSOURCE" } });

    assert.equal(lineOf(result, "burial").amount, 10000);
    assert.match(lineOf(result, "burial").basis, /any cause/);
    assert.equal(result.total, 565000);
  });

  test("a burial benefit the employee is enrolled in is used before the terms", () => {
    const coverage = [...COVERAGE, { code: "BMSR", description: "Burial", amount: 15000, formula: null }];

    assert.equal(lineOf(assess("death", { manner_of_death: "NATURAL" }, { coverage, insured: { company_code: "FIRSTSOURCE" } }), "burial").amount, 15000);
  });

  test("a suicide is compensable, and says so", () => {
    assert.match(textsOf(assess("death", { manner_of_death: "SUICIDE" }), "note").join(" "), /suicide.*compensable/i);
  });

  test("a death past the basic plan's age limit is warned about", () => {
    const result = assess("death", { manner_of_death: "NATURAL" }, { computed: { ...INCONTESTABLE, age_at_event: 72 } });

    assert.match(textsOf(result, "warning").join(" "), /age limit of 71/);
  });

  test("an accidental death past the rider age limit loses the accidental benefit and keeps the life benefit", () => {
    const result = assess("death", { manner_of_death: "ACCIDENT" }, { computed: { ...INCONTESTABLE, age_at_event: 68 } });

    assert.equal(lineOf(result, "life").amount, 500000);
    assert.equal(lineOf(result, "accidental").amount, null);
    assert.match(lineOf(result, "accidental").basis, /age limit of 66/);
  });

  test("a contestable death takes 30 business days and an incontestable one 15", () => {
    assert.equal(assess("death", {}, { computed: CONTESTABLE }).turnaround_business_days, 30);
    assert.equal(assess("death", {}).turnaround_business_days, 15);
    assert.match(textsOf(assess("death", {}, { computed: CONTESTABLE }), "warning").join(" "), /Contestable/);
    assert.match(textsOf(assess("death", {}), "ok").join(" "), /Incontestable/);
  });
});

describe("a total and permanent disability claim", () => {
  test("pays the disability benefit in full", () => {
    const result = assess("tpd", { cause: "SICKNESS" });

    assert.deepEqual(result.lines.map((entry) => [entry.key, entry.amount]), [["tpd", 500000]]);
    assert.equal(result.total, 500000);
    assert.equal(result.turnaround_business_days, 15);
  });

  test("past the rider age limit the benefit does not apply", () => {
    const result = assess("tpd", {}, { computed: { ...INCONTESTABLE, age_at_event: 67 } });

    assert.equal(lineOf(result, "tpd").amount, null);
    assert.equal(result.total, null);
    assert.match(textsOf(result, "warning").join(" "), /age limit of 66/);
  });

  test("without the benefit enrolled the line says so", () => {
    const result = assess("tpd", {}, { coverage: [] });

    assert.equal(lineOf(result, "tpd").amount, null);
    assert.match(lineOf(result, "tpd").basis, /No total and permanent disability benefit is enrolled/);
  });
});

describe("a terminal illness claim", () => {
  test("pays the share of the life benefit its formula names", () => {
    const result = assess("terminal_illness", {});

    assert.equal(lineOf(result, "terminal_illness").amount, 250000);
    assert.match(lineOf(result, "terminal_illness").basis, /50% of the life benefit PHP 500,000/);
  });

  test("is capped by the company's terms", () => {
    const coverage = COVERAGE.map((benefit) => (benefit.code === "GTLIP" ? { ...benefit, amount: 10000000 } : benefit));
    const result = assess("terminal_illness", {}, { coverage, insured: { company_code: "FIRSTSOURCE" } });

    assert.equal(lineOf(result, "terminal_illness").amount, 4000000);
    assert.match(lineOf(result, "terminal_illness").basis, /capped at PHP 4,000,000/);
  });

  test("a benefit with an amount of its own pays that", () => {
    const coverage = COVERAGE.map((benefit) => (benefit.code === "GTIR" ? { ...benefit, amount: 120000, formula: null } : benefit));

    assert.equal(lineOf(assess("terminal_illness", {}, { coverage }), "terminal_illness").amount, 120000);
  });

  test("a share of a life benefit whose amount is not stored cannot be worked out", () => {
    const coverage = COVERAGE.map((benefit) => (benefit.code === "GTLIP" ? { ...benefit, amount: null, formula: "24 x MONTHLY BASIC SALARY" } : benefit));
    const result = assess("terminal_illness", {}, { coverage });

    assert.equal(lineOf(result, "terminal_illness").amount, null);
    assert.equal(result.complete, false);
  });
});

describe("a dismemberment claim", () => {
  test("pays the accidental benefit times the percentage of the loss", () => {
    for (const [loss, percent] of [["ONE_HAND", 50], ["THUMB", 15], ["ARM_ABOVE_ELBOW", 70], ["BOTH_FEET", 100], ["OTHER_TOE", 1], ["HEARING_ONE_EAR", 25]]) {
      const result = assess("dismemberment", { type_of_loss: loss });

      assert.equal(lineOf(result, "dismemberment").amount, (500000 * percent) / 100, loss);
    }

    assert.match(lineOf(assess("dismemberment", { type_of_loss: "ONE_HAND" }), "dismemberment").basis, /PHP 500,000 × 50% \(loss of a hand\)/);
  });

  test("a loss the schedule does not name has no figure, and the claims department decides", () => {
    const result = assess("dismemberment", { type_of_loss: "OTHER", loss_description: "Loss of three fingers" });

    assert.equal(lineOf(result, "dismemberment").amount, null);
    assert.match(lineOf(result, "dismemberment").basis, /claims department decides/);
    assert.equal(result.complete, false);
  });

  test("without an accidental benefit enrolled the line says so", () => {
    const result = assess("dismemberment", { type_of_loss: "ONE_HAND" }, { coverage: COVERAGE.filter((benefit) => benefit.code !== "GADDR") });

    assert.equal(lineOf(result, "dismemberment").amount, null);
    assert.match(lineOf(result, "dismemberment").basis, /No accidental death and dismemberment benefit/);
  });

  test("past the rider age limit it does not apply", () => {
    const result = assess("dismemberment", { type_of_loss: "ONE_HAND" }, { computed: { ...INCONTESTABLE, age_at_event: 70 } });

    assert.equal(lineOf(result, "dismemberment").amount, null);
  });
});

describe("what to check", () => {
  test("filed within 30 days of the event is fine, later is a warning that does not void the claim, and past 90 days says proof of loss", () => {
    assert.match(textsOf(assess("tpd", {}, { filedOn: "2026-10-12" }), "ok").join(" "), /Filed 10 days after the event, within the 30 days/);
    assert.match(textsOf(assess("tpd", {}, { filedOn: "2026-11-15" }), "warning").join(" "), /Filed 44 days.*Notice of claim is due within 30 days.*does not invalidate/);
    assert.match(textsOf(assess("tpd", {}, { filedOn: "2027-02-01" }), "warning").join(" "), /Proof of loss is due within 90 days/);
    assert.match(textsOf(assess("tpd", {}, { filedOn: "2026-10-03" }), "ok").join(" "), /Filed 1 day after/);
  });

  test("a filing date that is a Date is read as the Philippine day", () => {
    assert.match(textsOf(assess("tpd", {}, { filedOn: new Date(2026, 9, 12, 9, 0) }), "ok").join(" "), /Filed 10 days/);
  });

  test("an event outside a company's policy period is a warning, and with no period nothing is said", () => {
    const outside = assess("tpd", {}, { insured: { company_code: "FIRSTSOURCE" }, details: { event: { date: "2026-09-30" }, condition: {} } });
    const inside = assess("tpd", {}, { insured: { company_code: "FIRSTSOURCE" } });

    assert.match(textsOf(outside, "warning").join(" "), /outside the policy period, 2026-10-01 to 2027-09-30/);
    assert.equal(textsOf(inside, "warning").some((text) => /policy period/.test(text)), false);
    assert.equal(textsOf(assess("tpd", { }, { details: { event: { date: "2020-01-01" }, condition: {} } }), "warning").some((text) => /policy period/.test(text)), false);
  });

  test("an event before the coverage started is a warning", () => {
    assert.match(textsOf(assess("tpd", {}, { computed: { ...INCONTESTABLE, event_before_coverage: true } }), "warning").join(" "), /before the coverage started/);
  });

  test("an unknown age or missing facts do not raise an age warning or throw", () => {
    const result = assess("tpd", {}, { computed: undefined, details: { event: {}, condition: {} }, insured: undefined, filedOn: undefined });

    assert.equal(result.lines.length, 1);
    assert.equal(textsOf(result, "warning").length, 0);
  });

  test("always says how long the claim takes", () => {
    for (const profile of ["death", "tpd", "terminal_illness", "dismemberment"])
      assert.match(textsOf(assess(profile, { type_of_loss: "ONE_HAND" }), "note").join(" "), /Processing takes 15 business days/);
  });

  test("names the terms it used", () => {
    assert.equal(assess("tpd", {}).policy, "Standard policy terms");
    assert.match(assess("tpd", {}, { insured: { company_code: "FIRSTSOURCE" } }).policy, /Firstsource/);
  });
});
