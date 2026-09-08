import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { sqlErrorMap } from "../../src/utils/sqlErrorMap.js";

// Each of these was mapped because somebody met it as a bare "Server Error".
// The status code is the part worth pinning: it decides whether the frontend
// shows the message, retries, or sends the user somewhere else.
const MUST_BE_MAPPED = [
  [50001, 403, /no longer active/i],
  [50133, 403, /not authorized/i],
  [50007, 409, /same name/i],
  [50008, 400, /cannot exceed 100/i],
  [50019, 409, /already submitted/i],
  [50033, 400, /Invalid Credentials/i],
  [50083, 409, /SSS\/GSIS number already registered/i],
  [50018, 400, /classification is no longer available/i],
  [50052, 500, /contact your HR/i],
  [50071, 500, /not set up for enrollment/i],
  [50072, 500, /enrollment limit for the year/i],
  [50038, 403, /no longer active/i],
  [50063, 409, /no longer active/i],
  [50079, 404, /Enrollment not found/i],
  [50081, 404, /Enrollment not found/i],
  [50082, 404, /No enrollment is linked/i],
  [50108, 400, /Invalid beneficiary change action/i],
  [50109, 400, /Invalid beneficiary reference/i],
  [50134, 403, /cannot view employee enrollment/i],
  [50078, 409, /already completed an enrollment/i],
  // Renumbered by the DBA on 2026-09-08. Submit keeps 110/111/112, approve
  // moved to 118/119/120, and reject throws 50121 — which was never mapped
  // until the same day.
  [50110, 400, /name and a coverage percentage/i],
  [50111, 409, /same name/i],
  [50112, 400, /total exactly 100%/i],
  [50118, 404, /no pending change request/i],
  [50119, 409, /no longer active/i],
  [50120, 409, /TIN number/i],
  [50121, 404, /no pending change request/i],
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

  // The test that used to sit here pinned 50110/50111/50112 to the APPROVE
  // meanings and said the collision "is not resolved here". It was doing its
  // job: one number cannot hold two messages, and flipping the three to the
  // submit meanings would have repaired one path by breaking the other.
  //
  // The DBA renumbered on 2026-09-08 — the approve procedure rather than the
  // submit one we asked for, which resolves it just as well. The guard has done
  // what it was for and is replaced by the real division below.
  test("the two change request procedures no longer share a number", () => {
    // Read from the THROW audit on 2026-09-08, not from either procedure's
    // reputation. Submit kept its three; approve moved to 118/119/120.
    const SUBMIT = {
      50110: /name and a coverage percentage/i,
      50111: /same name/i,
      50112: /total exactly 100%/i,
    };

    const APPROVE = {
      50118: /no pending change request/i,
      50119: /no longer active/i,
      50120: /TIN number/i,
    };

    for (const [number, message] of Object.entries({ ...SUBMIT, ...APPROVE })) {
      assert.ok(sqlErrorMap[number], `${number} is not mapped`);
      assert.match(sqlErrorMap[number].message, message);
    }

    // The defect this whole exchange existed to remove: an employee submitting
    // two beneficiaries with the same name used to be told their record was no
    // longer active. It is reachable — validateEnrollmentUpdate checks the
    // coverage total and that a name is present, but not that the names differ.
    assert.doesNotMatch(sqlErrorMap[50111].message, /no longer active/i);
  });

  // usp_upd_client_change_request_reject throws 50121 and nothing else. The map
  // held 50120 for it, which that procedure has never thrown, so a reject of an
  // already-decided request answered a generic 500 while the map looked like it
  // covered the case.
  //
  // A wrong entry hides a missing one better than an empty space would, which
  // is why this is pinned rather than simply fixed.
  test("the reject procedure's number is the one it actually throws", () => {
    assert.ok(sqlErrorMap[50121], "50121 is not mapped — reject answers a 500");
    assert.equal(sqlErrorMap[50121].statusCode, 404);

    assert.doesNotMatch(
      sqlErrorMap[50120].message,
      /no pending change request/i,
      "50120 is the approve procedure's TIN conflict, not the reject procedure's missing request",
    );
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

    // Thrown by usp_ins_enrollment_invitation and deliberately not mapped:
    // invitationService.js:99 catches it and marks that one recipient
    // `already_invited` instead of failing the send. A mapping would be dead
    // code and would hide where the handling actually is.
    [50064, "invitationService catches it to mark one recipient already_invited rather than failing the send"],

    // Was mapped to "You are not authorized to view employee information",
    // taken from usp_sel_hr_employees. That procedure now throws 50133 for the
    // same check with the same sentence, so the entry was dead — and 50002 is
    // usp_del_beneficiary's "beneficiary does not exist", which nothing calls
    // yet. Keeping the old entry would have meant the first caller of that
    // procedure got an authorization message for a missing beneficiary.
    [50002, "usp_sel_hr_employees renumbered its role guard to 50133, and 50002 now belongs to usp_del_beneficiary with a different meaning"],
  ];

  for (const [number, why] of DELIBERATELY_ABSENT) {
    test(`${number} stays unmapped — ${why}`, () => {
      assert.equal(sqlErrorMap[number], undefined);
    });
  }
});
