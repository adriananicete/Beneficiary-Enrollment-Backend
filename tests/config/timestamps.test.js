import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";

const { sql, datesAsText, dbConfig } = await import("../../src/config/db.js");
const { localIsoDate } = await import("../../src/utils/localDate.js");

// Every timestamp the API returned was Philippine local time labelled UTC:
// written at 13:19, answered as "13:19Z". Found 2026-10-06; the backend's
// times must be right (decided by Adrian). The fix is three parts, each
// tested here. Whether the driver really reads them that way can only be
// proven against the database; that is the manual check in the PR.

describe("the process runs on Philippine time", () => {
  // timezone.js sets it, imported first by env.js, which db.js imports.
  test("TZ is Asia/Manila, at +08:00", () => {
    assert.equal(process.env.TZ, "Asia/Manila");
    assert.equal(new Date(2026, 0, 1).getTimezoneOffset(), -480);
    assert.equal(new Date(2026, 6, 1).getTimezoneOffset(), -480);
  });

  // timezone.js has already run and is not run again, so a TZ changed
  // afterwards is exactly what env.js has to catch.
  test("env.js refuses to start when something else has set the zone", async () => {
    const saved = process.env.TZ;
    process.env.TZ = "UTC";

    try {
      await assert.rejects(
        () => import(`../../src/config/env.js?tz=${Math.random()}`),
        /not on Philippine time \(UTC\+8\)/,
      );
    } finally {
      process.env.TZ = saved;
    }
  });
});

describe("the driver reads datetimes as local time", () => {
  test("useUTC is false", () => {
    assert.equal(dbConfig.options.useUTC, false);
  });
});

describe("datesAsText — DATE columns leave as YYYY-MM-DD", () => {
  // What the driver hands back with useUTC: false, for a DATE of 1990-05-01
  // and a DATETIME of 13:19 local: both as Philippine local times.
  const recordset = (rows, columns) =>
    Object.defineProperty(rows, "columns", { value: columns, enumerable: false });

  const result = () => {
    const first = recordset(
      [
        { birthdate: new Date(1990, 4, 1), created_date: new Date(2026, 9, 6, 13, 19, 22) },
        { birthdate: null, created_date: null },
      ],
      {
        birthdate: { name: "birthdate", type: sql.Date },
        created_date: { name: "created_date", type: sql.DateTime },
      },
    );
    const second = recordset([{ d: new Date(2000, 0, 31) }], { d: { name: "d", type: sql.Date } });

    return { recordsets: [first, second], recordset: first };
  };

  // JSON would have printed "1990-04-30T16:00:00.000Z": a day early to
  // anybody who keeps the first ten characters.
  test("a DATE becomes its own day, as text", () => {
    const out = datesAsText(result());

    assert.equal(out.recordset[0].birthdate, "1990-05-01");
    assert.equal(out.recordsets[1][0].d, "2000-01-31");
  });

  test("a DATETIME stays a Date, and serialises as its true instant", () => {
    const out = datesAsText(result());

    assert.ok(out.recordset[0].created_date instanceof Date);
    assert.equal(JSON.stringify(out.recordset[0].created_date), '"2026-10-06T05:19:22.000Z"');
  });

  test("a NULL date stays null", () => {
    assert.equal(datesAsText(result()).recordset[1].birthdate, null);
  });

  test("a result with no recordsets, or none with metadata, passes through", () => {
    assert.deepEqual(datesAsText({ rowsAffected: [1] }), { rowsAffected: [1] });
    assert.deepEqual(datesAsText({ recordsets: [[{ a: 1 }]] }).recordsets, [[{ a: 1 }]]);
    assert.equal(datesAsText(undefined), undefined);
  });

  test("is applied to every request the driver makes", () => {
    assert.equal(sql.Request.prototype[Symbol.for("beneficiary-enrollment.datesAsText")], true);
  });
});

describe("localIsoDate — the Philippine date", () => {
  for (const [label, instant, expected] of [
    ["00:30 in Manila, still the day before in UTC", "2026-10-05T16:30:00.000Z", "2026-10-06"],
    ["23:59:59 in Manila", "2026-10-06T15:59:59.000Z", "2026-10-06"],
    ["midnight in Manila", "2026-10-06T16:00:00.000Z", "2026-10-07"],
  ])
    test(label, () => {
      assert.equal(localIsoDate(new Date(instant)), expected);
    });
});
