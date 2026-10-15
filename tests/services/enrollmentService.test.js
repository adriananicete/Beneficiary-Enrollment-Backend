import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";
import { fakePool, inputsFor } from "../helpers/fakePool.js";

const { default: EnrollmentService } = await import(
  "../../src/services/enrollmentService.js"
);
const { sqlErrorMap } = await import("../../src/utils/sqlErrorMap.js");

// The public enrollment submit path, and the last service to get assertions.
//
// Everything covered here happens BEFORE the transaction opens: seven refusals
// that decide whether a stranger holding an invitation link gets to write to
// this database. The transaction body is deliberately not driven — its
// correctness is whether the database agrees with us on insert order and
// procedure contracts, and a fake transaction agrees with whatever it is told.
// Two defects found on 2026-09-08 were exactly that. The rollback was proven
// end to end on 2026-09-04, when a duplicate beneficiary name answered 409 and
// left nothing behind.

const TOKEN = "usp_sel_enrollment_invitation_by_token";
const EMPLOYERS = "usp_sel_employers";
const CLASSIFICATIONS = "usp_sel_classifications_by_employer";

const BARANGAY_QUERY = /dbo\.barangay/;
const USERNAME_QUERY = /us01_users/;

const validInvitation = (overrides = {}) => ({
  invitation_id: 54,
  employer_id: 1,
  email_address: "invited@coforge.com",
  is_valid: 1,
  is_enrolled: 0,
  ...overrides,
});

const submission = (overrides = {}) => ({
  token: "a".repeat(64),
  employee_id_number: "EMP-099",
  employer_id: 1,
  classification_id: 3,
  barangay_id: "012801001",
  email_address: "whatever-the-form-said@example.com",
  first_name: "Ana",
  last_name: "Reyes",
  beneficiaries: [],
  ...overrides,
});

// Defaults let every guard pass, so a test names the one thing it is breaking.
const enrol = (data, { invitation, employers, classifications, barangayReal = true, usernameTaken = false } = {}) => {
  const { pool, calls } = fakePool(
    {
      [TOKEN]: invitation === null ? [] : [invitation ?? validInvitation()],
      [EMPLOYERS]: employers ?? [{ employer_id: 1 }, { employer_id: 2 }],
      [CLASSIFICATIONS]: classifications ?? [{ classification_id: 3 }],
    },
    [
      [BARANGAY_QUERY, barangayReal ? [{ ok: 1 }] : []],
      [USERNAME_QUERY, usernameTaken ? [{ ok: 1 }] : []],
    ],
  );

  return { calls, result: EnrollmentService.createEnrollment(pool, data) };
};

describe("enrollmentService — the invitation guards", () => {
  test("refuses a token that matches nothing", async () => {
    await assert.rejects(
      () => enrol(submission(), { invitation: null }).result,
      (error) => error.statusCode === 404 && /Invitation not found/.test(error.message),
    );
  });

  // is_valid and is_enrolled are computed in the procedure, and the two
  // procedures that compute them do not agree on the type: the by-token one
  // returns a bare INT, the by-user one CASTs to BIT, which mssql hands back as
  // a boolean. A strict comparison is correct against one and silently false
  // against the other — which is how the resend guard died.
  //
  // Both types are pinned here because these two are on the PUBLIC path. A dead
  // guard here accepts an expired invitation or a second enrollment.
  for (const expired of [0, false]) {
    test(`refuses an expired invitation when is_valid arrives as ${typeof expired} ${expired}`, async () => {
      await assert.rejects(
        () => enrol(submission(), { invitation: validInvitation({ is_valid: expired }) }).result,
        (error) => error.statusCode === 410 && /expired/.test(error.message),
      );
    });
  }

  for (const enrolled of [1, true]) {
    test(`refuses a second enrollment when is_enrolled arrives as ${typeof enrolled} ${enrolled}`, async () => {
      await assert.rejects(
        () => enrol(submission(), { invitation: validInvitation({ is_enrolled: enrolled }) }).result,
        (error) => error.statusCode === 409 && /already submitted/.test(error.message),
      );
    });
  }

  // The invitation decides the company and the address, not the form. Without
  // this, anybody holding a forwarded link could enrol themselves into a
  // different employer, and the confirmation email — with the temporary
  // password in it — would go wherever they asked.
  test("takes the employer and the email from the invitation, overwriting the form", async () => {
    const data = submission({
      employer_id: 999,
      email_address: "attacker@example.com",
    });

    // Stops at the username guard, which is after every check that reads the
    // overwritten values. 999 is not in the employers list, so reaching this
    // refusal at all proves the employer check ran against the invitation's 1.
    await assert.rejects(
      () => enrol(data, { usernameTaken: true }).result,
      (error) => error.statusCode === 409 && /Employee ID number already exists/.test(error.message),
    );

    assert.equal(data.employer_id, 1);
    assert.equal(data.email_address, "invited@coforge.com");
  });
});

describe("enrollmentService — the reference guards", () => {
  test("refuses an employer that is not active", async () => {
    await assert.rejects(
      () =>
        enrol(submission(), {
          invitation: validInvitation({ employer_id: 77 }),
          employers: [{ employer_id: 1 }],
        }).result,
      (error) => error.statusCode === 400 && /employer/i.test(error.message),
    );
  });

  test("refuses a classification that is not in the company's active list", async () => {
    await assert.rejects(
      () => enrol(submission({ classification_id: 99 })).result,
      (error) =>
        error.statusCode === 400 &&
        error.message === "That classification is not available for your company",
    );
  });

  // The reference id that used to go unchecked. Six fabricated barangay codes
  // reached the database through the gap, and it fails silently in both
  // directions: nothing errors on the way in, and the address still displays
  // afterwards because full_address and zip_code are stored separately.
  test("refuses a barangay code that resolves to nothing", async () => {
    await assert.rejects(
      () => enrol(submission(), { barangayReal: false }).result,
      (error) => error.statusCode === 400 && /barangay/i.test(error.message),
    );
  });

  // barangay_id is VARCHAR and its codes carry leading zeros. The check
  // compares the code as given rather than coercing it, since this is the last
  // place that would notice a zero going missing.
  test("checks the barangay code exactly as it arrived, leading zero intact", async () => {
    const { calls, result } = enrol(submission(), { usernameTaken: true });
    await assert.rejects(() => result);

    const barangayCall = calls.find((call) => BARANGAY_QUERY.test(call.query ?? ""));

    assert.equal(barangayCall.inputs.brgy_code, "012801001");
  });

  test("refuses an employee id that already has an account", async () => {
    await assert.rejects(
      () => enrol(submission(), { usernameTaken: true }).result,
      (error) => error.statusCode === 409 && /already exists/.test(error.message),
    );
  });
});

// Classifications belong to a company since DBA request 23. Coforge keeps
// 1–10 and HCL has its own copies, 11–20, with the same codes.
describe("enrollmentService — the company's classifications", () => {
  const byCompany = ({ employer_id }) => ({
    recordset:
      String(employer_id) === "1"
        ? [{ classification_id: "1" }, { classification_id: "3" }]
        : [{ classification_id: "11" }, { classification_id: "13" }],
    output: {},
  });

  test("asks for the invitation's company's classes, not the form's", async () => {
    const { calls, result } = enrol(submission({ employer_id: 2 }), {
      classifications: byCompany,
      usernameTaken: true,
    });
    await assert.rejects(() => result);

    assert.equal(inputsFor(calls, CLASSIFICATIONS).employer_id, 1);
  });

  // HCL's copy of a class Coforge also has. The id is real and active, which
  // is exactly what the old global check accepted.
  test("refuses another company's class, even one with the same code", async () => {
    await assert.rejects(
      () => enrol(submission({ classification_id: 11 }), { classifications: byCompany }).result,
      (error) =>
        error.statusCode === 400 &&
        error.message === "That classification is not available for your company",
    );
  });

  // The ids come back from the procedure as strings (BigInt) and arrive from
  // the form as numbers. Both sides are compared as text.
  test("accepts the company's own class whatever type its id arrives as", async () => {
    await assert.rejects(
      () => enrol(submission({ classification_id: 3 }), { classifications: byCompany, usernameTaken: true }).result,
      (error) => error.statusCode === 409 && /Employee ID number already exists/.test(error.message),
    );
  });

  // usp_ins_insurance_enrollment refuses the same case with 50180. One
  // sentence, whichever guard fires.
  test("answers the same sentence the procedure's 50180 maps to", async () => {
    await assert.rejects(
      () => enrol(submission({ classification_id: 11 }), { classifications: byCompany }).result,
      (error) => error.message === sqlErrorMap[50180].message,
    );
  });
});

// Branch 6 of the onboarding effort: HR assigns the class and the affiliate on
// the invitation, and the form's values are ignored, not compared. usernameTaken
// stops a passing submission at the last guard, after the assignment, so the
// test can read what the service decided.
describe("enrollmentService — the class and the affiliate HR assigned", () => {
  const COMPANY_CLASSES = [{ classification_id: "1" }, { classification_id: "3" }];

  const submitWith = (data, invitationOverrides) =>
    enrol(data, {
      invitation: validInvitation(invitationOverrides),
      classifications: COMPANY_CLASSES,
      usernameTaken: true,
    }).result;

  const PASSED = (error) => /Employee ID number already exists/.test(error.message);

  test("the invitation's class wins over a different one in the body", async () => {
    const data = submission({ classification_id: 3 });

    await assert.rejects(() => submitWith(data, { classification_id: "1" }), PASSED);
    assert.equal(data.classification_id, "1");
  });

  // Not compared: a body class that would be refused on its own does not
  // matter when the invitation carries one.
  test("a body class that is not the company's is ignored, not refused", async () => {
    const data = submission({ classification_id: 999 });

    await assert.rejects(() => submitWith(data, { classification_id: "3" }), PASSED);
    assert.equal(data.classification_id, "3");
  });

  test("no class in the body is fine when the invitation has one", async () => {
    const data = submission();
    delete data.classification_id;

    await assert.rejects(() => submitWith(data, { classification_id: "3" }), PASSED);
    assert.equal(data.classification_id, "3");
  });

  // Adrian, 2026-10-15: the employee cannot change it, so HR must.
  test("an assigned class retired since the invitation is 409, to contact HR", async () => {
    await assert.rejects(
      () => submitWith(submission({ classification_id: 3 }), { classification_id: "2" }),
      (error) =>
        error.statusCode === 409 &&
        error.message === "Your classification is no longer available. Please contact your HR.",
    );
  });

  // An invitation sent before branch 6 has no class: the employee chooses.
  test("an older invitation without a class needs the body's", async () => {
    const data = submission();
    delete data.classification_id;

    await assert.rejects(
      () => submitWith(data, { classification_id: null }),
      (error) => error.statusCode === 400 && error.message === "classification_id is required",
    );
  });

  test("an older invitation without a class takes and checks the body's", async () => {
    const data = submission({ classification_id: 3 });
    await assert.rejects(() => submitWith(data, {}), PASSED);
    assert.equal(data.classification_id, 3);

    await assert.rejects(
      () => submitWith(submission({ classification_id: 99 }), {}),
      (error) => error.statusCode === 400 && error.message === "That classification is not available for your company",
    );
  });

  // Every model in the transaction reads the affiliate from enrollmentData, so
  // it is overwritten whatever the body sent, null included.
  test("the affiliate is the invitation's, overwriting the body's", async () => {
    const withAffiliate = submission({ affiliate_id: "999" });
    await assert.rejects(() => submitWith(withAffiliate, { classification_id: "3", affiliate_id: "7" }), PASSED);
    assert.equal(withAffiliate.affiliate_id, "7");

    const companyItself = submission({ affiliate_id: "999" });
    await assert.rejects(() => submitWith(companyItself, { classification_id: "3", affiliate_id: null }), PASSED);
    assert.equal(companyItself.affiliate_id, null);

    const older = submission({ affiliate_id: "999" });
    await assert.rejects(() => submitWith(older, {}), PASSED);
    assert.equal(older.affiliate_id, null);
  });
});

// The company's online age limit, branch 8, on DBA request 23's
// online_enrollment_max_age. Birthdates are built from today, so the boundary
// is exact whatever day the suite runs.
describe("enrollmentService — the company's online age limit", () => {
  const pad = (n) => String(n).padStart(2, "0");
  const turning = (age, daysFromToday = 0) => {
    const day = new Date();
    day.setDate(day.getDate() + daysFromToday);
    return `${day.getFullYear() - age}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
  };

  const AGE_REFUSAL = "Your enrollment cannot be completed online. Please contact your HR.";

  // usernameTaken stops a passing submission at the last guard, after the age
  // check, so "passes" means "reached that 409, not the age one".
  const submitAt = (birthdate, limit) =>
    enrol(submission({ birthdate }), {
      invitation: validInvitation({ online_enrollment_max_age: limit }),
      usernameTaken: true,
    }).result;

  test("66 today is refused under a limit of 65", async () => {
    await assert.rejects(
      () => submitAt(turning(66), 65),
      (error) => error.statusCode === 409 && error.message === AGE_REFUSAL,
    );
  });

  // The day before the 66th birthday the employee is still 65.
  test("turning 66 tomorrow is still 65, and passes", async () => {
    await assert.rejects(
      () => submitAt(turning(66, 1), 65),
      (error) => /Employee ID number already exists/.test(error.message),
    );
  });

  test("65 exactly passes", async () => {
    await assert.rejects(
      () => submitAt(turning(65), 65),
      (error) => /Employee ID number already exists/.test(error.message),
    );
  });

  test("no limit means none, however old", async () => {
    for (const limit of [null, undefined])
      await assert.rejects(
        () => submitAt(turning(90), limit),
        (error) => /Employee ID number already exists/.test(error.message),
        String(limit),
      );
  });

  // Refused before anything is read or written beyond the invitation.
  test("the refusal comes before the reference checks and any write", async () => {
    const { calls, result } = enrol(submission({ birthdate: turning(70) }), {
      invitation: validInvitation({ online_enrollment_max_age: 65 }),
    });

    await assert.rejects(() => result, (error) => error.message === AGE_REFUSAL);
    assert.deepEqual(
      calls.map((call) => call.procedure ?? "query"),
      [TOKEN],
    );
  });
});

describe("enrollmentService — reading an enrollment back", () => {
  const DETAILS = "usp_get_insurance_enrollment_by_id";
  const BENEFITS = "usp_get_enrollment_benefits_by_id";

  test("returns the enrollment and its benefits together", async () => {
    const { pool, calls } = fakePool({
      [DETAILS]: [{ enrollment_id: 54, client_id: 75 }],
      [BENEFITS]: [{ benefit_name: "GTLIP", amount: 1000000 }],
    });

    const result = await EnrollmentService.getFullEnrollmentDetails(pool, 75);

    assert.equal(result.enrollment.length, 1);
    assert.equal(result.benefits.length, 1);
    assert.equal(inputsFor(calls, DETAILS).client_id, 75);
  });

  // 404 rather than an empty envelope. An enrollment that is not there is not
  // the same answer as one with nothing in it.
  test("refuses a client with no enrollment", async () => {
    const { pool } = fakePool({ [DETAILS]: [], [BENEFITS]: [] });

    await assert.rejects(
      () => EnrollmentService.getFullEnrollmentDetails(pool, 75),
      (error) => error.statusCode === 404 && /Enrollment not found/.test(error.message),
    );
  });

  // The benefits query never runs when there is no enrollment — the guard is
  // above it, and a second round trip for a client that does not exist is work
  // nobody asked for.
  test("does not ask for benefits when there is no enrollment", async () => {
    const { pool, calls } = fakePool({ [DETAILS]: [], [BENEFITS]: [] });

    await EnrollmentService.getFullEnrollmentDetails(pool, 75).catch(() => {});

    assert.ok(!calls.some((call) => call.procedure === BENEFITS));
  });
});
