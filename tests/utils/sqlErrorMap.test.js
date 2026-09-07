import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { sqlErrorMap } from "../../src/utils/sqlErrorMap.js";

// Each of these was mapped because somebody met it as a bare "Server Error".
// The status code is the part worth pinning: it decides whether the frontend
// shows the message, retries, or sends the user somewhere else.
const MUST_BE_MAPPED = [
  [50001, 403, /no longer active/i],
  [50002, 403, /not authorized/i],
  [50007, 409, /same name/i],
  [50008, 400, /cannot exceed 100/i],
  [50019, 409, /already submitted/i],
  [50033, 400, /Invalid Credentials/i],
  [50083, 409, /SSS\/GSIS number already registered/i],
  [50018, 400, /classification is no longer available/i],
  [50052, 500, /contact your HR/i],
  [50071, 500, /not set up for enrollment/i],
  [50072, 500, /enrollment limit for the year/i],
  [50078, 409, /already completed an enrollment/i],
  [50110, 404, /no pending change request/i],
  [50115, 400, /100%/],
  [50117, 409, /same name/i],
];

describe("sqlErrorMap", () => {
  for (const [number, statusCode, message] of MUST_BE_MAPPED) {
    test(`${number} answers ${statusCode}`, () => {
      const mapped = sqlErrorMap[number];

      assert.ok(mapped, `${number} is not mapped — it would reach the caller as a 500`);
      assert.equal(mapped.statusCode, statusCode);
      assert.match(mapped.message, message);
    });
  }

  test("every entry has both a status code and a message", () => {
    for (const [number, mapped] of Object.entries(sqlErrorMap)) {
      assert.equal(typeof mapped.statusCode, "number", `${number} statusCode`);
      assert.equal(typeof mapped.message, "string", `${number} message`);
      assert.ok(mapped.message.length > 0, `${number} message is empty`);
    }
  });

  test("2627 stays, and stays generic — it is the fallback these numbers exist to avoid", () => {
    // SQL Server's own unique-constraint violation. It fires for any unique
    // index on any table, so it can never name the column and its message can
    // never be more useful than this. Every mapped duplicate number above is
    // one more case that no longer lands here.
    //
    // Pinned so nobody makes it specific: the day it says "TIN already
    // registered" is the day some unrelated constraint tells that lie.
    assert.equal(sqlErrorMap[2627].statusCode, 409);
    assert.match(sqlErrorMap[2627].message, /^Duplicate record$/);
  });

  test("the three fields with a unique index all have a mapped number", () => {
    // dbo.clients carries UNIQUE indexes on tin_id and sss_gsis_no, and
    // sec.us01_users on us01_username. Each needs a procedure check with a
    // mapped number, or the caller gets 2627 instead of a sentence.
    //
    // sss_gsis_no had neither until 2026-09-07: the index existed, nothing
    // checked it, and a duplicate reached the employee as "Duplicate record".
    for (const number of [50009, 50035, 50083]) {
      assert.ok(sqlErrorMap[number], `${number} is not mapped`);
      assert.equal(sqlErrorMap[number].statusCode, 409, `${number}`);
      assert.match(
        sqlErrorMap[number].message,
        /already registered/i,
        `${number} should say what is already taken`,
      );
    }
  });

  test("a 5xx entry still carries a real message, which is the point of mapping it", () => {
    // errorHandler returns mapped.message verbatim whatever the status code,
    // so a mapped 500 says something useful where an unmapped one says
    // "Server Error". That is the only reason these three are worth an entry.
    for (const number of [50052, 50071, 50072]) {
      const mapped = sqlErrorMap[number];

      assert.equal(mapped.statusCode, 500, `${number}`);
      assert.notEqual(mapped.message, "Server Error", `${number}`);
      assert.match(mapped.message, /contact your HR/i, `${number}`);
    }
  });

  test("the configuration faults stay 5xx — they are not the caller's fault", () => {
    // The line this file now draws. 4xx means the caller can fix it by
    // sending something different; these three cannot be fixed from the form
    // at any price, so calling them 4xx would send the employee back to retry
    // forever. Pinned so nobody "tidies" them into 400s.
    for (const number of [50052, 50071, 50072])
      assert.ok(sqlErrorMap[number].statusCode >= 500, `${number} must stay 5xx`);

    // And the contrast, from the same procedure: this one IS actionable —
    // pick a different classification — so it is a 400.
    assert.equal(sqlErrorMap[50018].statusCode, 400);
  });

  test("no entry leaks a raw procedure message", () => {
    // errorHandler returns mapped.message straight to the client, so these are
    // user-facing strings rather than the database's own wording.
    for (const [number, mapped] of Object.entries(sqlErrorMap)) {
      assert.ok(
        !/THROW|sql|procedure|dbo\./i.test(mapped.message),
        `${number} reads like internal text: ${mapped.message}`,
      );
    }
  });
});

describe("the numbers deliberately left unmapped", () => {
  // Absent on purpose, each with its reasoning recorded beside it in the source.
  // Asserted so a later sweep through the procedures does not "helpfully" add
  // them and turn an honest 500 into a misleading 4xx.
  const DELIBERATELY_ABSENT = [
    [50006, "the enrollment row was inserted moments earlier in the same transaction, so this firing is our fault and nothing the caller can act on"],
    [50034, "compares two bcrypt hashes for equality, which different salts make impossible — it cannot fire"],
    [50076, "means our own code sent an invalid send-status value, which is a bug on our side rather than something the caller can act on"],

    // The rest of the enrollment submit path, swept 2026-09-07. Every one of
    // these reports that a row written moments earlier in the same
    // transaction is missing — our fault, not the caller's, and a generic 500
    // is the honest answer. Mapping them would dress a bug up as advice.
    [50011, "the client was inserted moments earlier in the same transaction"],
    [50012, "the address was inserted moments earlier in the same transaction"],
    [50013, "the client-employer link was created moments earlier in the same transaction"],
    [50016, "the client was inserted moments earlier in the same transaction"],
    [50017, "the employer assignment was created moments earlier in the same transaction"],
    [50051, "the user was inserted moments earlier in the same transaction"],
    [50053, "the user was created moments earlier and cannot already have a role"],

    // Unreachable rather than ours: the agreement version is hardcoded to 1.0
    // and the client is always new, so a duplicate agreement cannot occur.
    [50005, "the client is always new and the agreement version is hardcoded, so a duplicate cannot occur"],
  ];

  for (const [number, why] of DELIBERATELY_ABSENT) {
    test(`${number} stays unmapped — ${why}`, () => {
      assert.equal(sqlErrorMap[number], undefined);
    });
  }
});
