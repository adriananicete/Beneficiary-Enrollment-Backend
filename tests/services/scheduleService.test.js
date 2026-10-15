import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";
import { fakePool } from "../helpers/fakePool.js";

const { default: ScheduleService, scheduleOf, benefitChanges, classFieldsAfter } = await import(
  "../../src/services/scheduleService.js"
);

// A company's schedule, DBA request 24. The writes run in one transaction of
// ours and are proven by hand: a fake transaction agrees with whatever it is
// told (CLAUDE.md §11). What is tested here is everything decided before the
// transaction opens: how the rows become classes, which writes a change
// means, and the refusals.

const COMPANY = "usp_sel_employer_admin_by_id";
const SCHEDULE = "usp_sel_classifications_admin";
const TYPES = "usp_sel_benefit_types";

const ADMIN_ID = 1;

// Coforge's VP as usp_sel_classifications_admin returns it: one row per
// active benefit.
const vpRows = (classOverrides = {}) =>
  [
    ["GTLIP", "1", 3000000, null],
    ["GTPDR", "2", 3000000, null],
    ["ALCR", "3", 55000, null],
    ["GTIR", "4", null, "50% OF GTLIP"],
  ].map(([benefit_code, classification_benefit_id, coverage_amount, coverage_formula]) => ({
    classification_id: "1",
    classification_code: "VP",
    classification_desc: "Vice President",
    is_active: true,
    active_enrollments: 14,
    modified_by: null,
    modified_date: null,
    classification_benefit_id,
    benefit_code,
    coverage_amount,
    coverage_formula,
    ...classOverrides,
  }));

// A retired class with no active benefit appears once, benefit columns NULL.
const bareRow = {
  classification_id: "2",
  classification_code: "AVP",
  classification_desc: "Associate Vice President",
  is_active: false,
  active_enrollments: 0,
  modified_by: "1",
  modified_date: null,
  classification_benefit_id: null,
  benefit_code: null,
  coverage_amount: null,
  coverage_formula: null,
};

describe("scheduleOf — the rows as classes", () => {
  test("one class per id, its benefits in the shape the Administrator sends", () => {
    assert.deepEqual(scheduleOf([...vpRows(), bareRow]), [
      {
        classification_id: "1",
        classification_code: "VP",
        classification_desc: "Vice President",
        is_active: true,
        active_enrollments: 14,
        modified_by: null,
        modified_date: null,
        benefits: { GTLIP: 3000000, GTPDR: 3000000, ALCR: 55000, GTIR: "50% OF GTLIP" },
      },
      {
        classification_id: "2",
        classification_code: "AVP",
        classification_desc: "Associate Vice President",
        is_active: false,
        active_enrollments: 0,
        modified_by: "1",
        modified_date: null,
        benefits: {},
      },
    ]);
  });

  // Ids come back from the driver as strings (BigInt); grouping must not
  // split a class whose rows carry the id in two types.
  test("groups by id whatever type it arrives as", () => {
    const rows = vpRows();
    rows[1].classification_id = 1;

    assert.equal(scheduleOf(rows).length, 1);
  });
});

describe("benefitChanges — which writes a PATCH means", () => {
  const stored = {
    GTLIP: { benefitId: "1", amount: 3000000, formula: null },
    GTIR: { benefitId: "4", amount: null, formula: "50% OF GTLIP" },
  };

  test("a changed amount is an update of that row", () => {
    assert.deepEqual(benefitChanges(stored, { GTLIP: 3500000 }), [
      { action: "update", code: "GTLIP", benefitId: "1", value: 3500000 },
    ]);
  });

  // An unchanged value is not rewritten, so modified_date keeps meaning
  // "this amount last changed then". The driver may hand the decimal back
  // as a string.
  test("an unchanged value is left alone, whatever type the stored amount arrives as", () => {
    assert.deepEqual(benefitChanges(stored, { GTLIP: 3000000, GTIR: "50% OF GTLIP" }), []);
    assert.deepEqual(
      benefitChanges({ GTLIP: { benefitId: "1", amount: "3000000.00", formula: null } }, { GTLIP: 3000000 }),
      [],
    );
  });

  test("a benefit the class lacks is an insert", () => {
    assert.deepEqual(benefitChanges(stored, { ALCR: 55000 }), [{ action: "insert", code: "ALCR", value: 55000 }]);
  });

  test("null retires a benefit the class has, and does nothing for one it lacks", () => {
    assert.deepEqual(benefitChanges(stored, { GTIR: null, GTPDR: null }), [
      { action: "retire", code: "GTIR", benefitId: "4" },
    ]);
  });

  test("a changed formula is an update", () => {
    assert.deepEqual(benefitChanges(stored, { GTIR: "40% OF GTLIP" }), [
      { action: "update", code: "GTIR", benefitId: "4", value: "40% OF GTLIP" },
    ]);
  });

  test("no benefits sent means no benefit writes", () => {
    assert.deepEqual(benefitChanges(stored, undefined), []);
  });
});

describe("classFieldsAfter — the class's own fields after a PATCH", () => {
  const row = vpRows()[0];

  test("the fields sent replace the stored ones; the rest are kept", () => {
    assert.deepEqual(classFieldsAfter(row, { classification_desc: "VP" }), {
      after: { code: "VP", desc: "VP", isActive: true },
      changed: true,
    });
  });

  // false is a value: retiring a class.
  test("is_active false retires the class", () => {
    assert.deepEqual(classFieldsAfter(row, { is_active: false }).after.isActive, false);
    assert.equal(classFieldsAfter(row, { is_active: false }).changed, true);
  });

  test("sending what is stored is no change", () => {
    assert.equal(classFieldsAfter(row, { classification_code: "VP", is_active: true }).changed, false);
    assert.equal(classFieldsAfter(row, { benefits: { GTLIP: 1 } }).changed, false);
  });
});

describe("ScheduleService — refusals before anything is written", () => {
  const poolWith = (answers) => fakePool({ [COMPANY]: [{ employer_id: "1" }], [SCHEDULE]: [], [TYPES]: [], ...answers });

  test("the schedule of a company that does not exist is 404", async () => {
    const { pool } = poolWith({ [COMPANY]: [] });

    await assert.rejects(
      () => ScheduleService.getSchedule(pool, ADMIN_ID, "99"),
      (error) => error.statusCode === 404 && error.message === "Company not found",
    );
  });

  test("a new class for a company that does not exist is 404", async () => {
    const { pool, calls } = poolWith({ [COMPANY]: [] });

    await assert.rejects(
      () => ScheduleService.createClass(pool, ADMIN_ID, "99", { classification_code: "X", classification_desc: "X", benefits: { GTLIP: 1 } }),
      (error) => error.statusCode === 404,
    );
    assert.ok(!calls.some((call) => call.procedure === TYPES));
  });

  // The catalogue is read, not hard-coded. A code it lacks is a setup fault,
  // refused before the transaction opens.
  test("a benefit missing from the catalogue is 500, before anything is written", async () => {
    const { pool } = poolWith({ [TYPES]: [{ benefit_code: "GTLIP", plan_id: "3", rider_id: null }] });

    await assert.rejects(
      () =>
        ScheduleService.createClass(pool, ADMIN_ID, "1", {
          classification_code: "X",
          classification_desc: "X",
          benefits: { GTLIP: 1, GTIR: "50% OF GTLIP" },
        }),
      (error) => error.statusCode === 500 && /GTIR benefit is not set up/.test(error.message),
    );
  });

  // The class is looked for in its company's schedule (option A, 2026-10-15),
  // so another company's class id is not found here.
  test("a class that is not in the company's schedule is 404", async () => {
    const { pool } = poolWith({ [SCHEDULE]: vpRows() });

    await assert.rejects(
      () => ScheduleService.updateClass(pool, ADMIN_ID, "1", "11", { classification_desc: "X" }),
      (error) => error.statusCode === 404 && error.message === "Classification not found",
    );
  });

  // Nothing would change, so no transaction is opened and nothing is
  // written; the class is answered as stored.
  test("a change to what is already stored writes nothing and answers the class", async () => {
    const { pool, calls } = poolWith({ [SCHEDULE]: vpRows() });

    const result = await ScheduleService.updateClass(pool, ADMIN_ID, "1", "1", {
      classification_desc: "Vice President",
      benefits: { GTLIP: 3000000, GTPDR: 3000000 },
    });

    assert.equal(result.classification_id, "1");
    assert.ok(!calls.some((call) => /^usp_(ins|upd)_/.test(call.procedure ?? "")));
    assert.ok(!calls.some((call) => call.procedure === TYPES));
  });
});
