import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";
import { fakePool, inputsFor } from "../helpers/fakePool.js";

const { default: InvitationService } = await import(
  "../../src/services/invitationService.js"
);
const { default: InvitationJobStore } = await import(
  "../../src/services/invitationJobStore.js"
);

// Reachable for the first time now that the pool is injected. What is covered
// here is the half of this service that decides things: the ownership guards
// behind revoke and resend, and the token that must never leave the server.
//
// The sending path is deliberately not driven. resendInvitation and the bulk
// job call sendInvitationEmail, which is a real Microsoft Graph request — a
// test that reaches it would be a network test wearing a unit test's clothes.
// Every case below stops at a guard that throws before any email is attempted.

const LIST = "bes.usp_sel_enrollment_invitations_by_user";
const BY_ID = "bes.usp_sel_enrollment_invitation_by_id";
const REVOKE = "bes.usp_del_enrollment_invitation";
const EMPLOYERS = "sec.us08_usp_sel_employers_by_user";
const CLASSES = "bes.usp_sel_classifications_by_employer";
const AFFILIATES = "bes.usp_sel_employer_affiliates_by_user";
const INSERT = "bes.usp_ins_enrollment_invitation";

// ABCC's codes, as the two procedures return them. The affiliate list carries
// every company the account is mapped to; 6's must be left out.
const ABCC_CODES = {
  [EMPLOYERS]: [{ employer_id: "5", company_code: "ABCC", company_name: "Abacus Book and Card Corporation" }],
  [CLASSES]: [
    { classification_id: "51", classification_code: "CLASS 1", classification_desc: "Officers" },
    { classification_id: "54", classification_code: "CLASS 4", classification_desc: "Rank and file" },
  ],
  [AFFILIATES]: [
    { employer_id: "5", affiliate_id: "7", affiliate_code: "ALAKOR", affiliate_name: "Alakor Corporation" },
    { employer_id: "6", affiliate_id: "9", affiliate_code: "QUAD", affiliate_name: "Another Group's Affiliate" },
  ],
};

// The job runs behind the response. Waits for it to stop processing.
const settled = async (jobId) => {
  for (let i = 0; i < 200; i++) {
    const job = InvitationJobStore.getJob(jobId);
    if (job.status !== "processing") return job;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("the job never finished");
};

const sqlError = (number) => Object.assign(new Error(`SQL ${number}`), { number });

const PAGING = { page: 1, pageSize: 25 };

const invitationRow = (overrides = {}) => ({
  invitation_id: 54,
  email_address: "ana.reyes@coforge.com",
  company_name: "Coforge",
  token: "a".repeat(64),
  is_enrolled: false,
  status: "A",
  send_status: "sent",
  total_count: 1,
  ...overrides,
});

describe("invitationService — the list", () => {
  // The token opens the enrollment form as the invited person. PR #49 removed
  // it from this response and the comment in the service says it has to survive
  // every reshape of it; this is that sentence as an assertion.
  test("strips the token from every row", async () => {
    const { pool } = fakePool({
      [LIST]: [
        invitationRow({ invitation_id: 54, total_count: 2 }),
        invitationRow({ invitation_id: 55, total_count: 2 }),
      ],
    });

    const page = await InvitationService.getInvitations(pool, 7, PAGING);

    assert.equal(page.rows.length, 2);
    for (const row of page.rows) {
      assert.ok(!("token" in row), "the token reached the caller");
    }

    // The rest of the row still arrives — a transform that dropped everything
    // would satisfy the assertion above and be useless.
    assert.equal(page.rows[0].email_address, "ana.reyes@coforge.com");
    assert.equal(page.rows[0].invitation_id, 54);
  });

  test("returns the shared paging envelope", async () => {
    const { pool } = fakePool({
      [LIST]: [invitationRow({ total_count: 105 })],
    });

    const page = await InvitationService.getInvitations(pool, 7, PAGING);

    assert.deepEqual(
      { page: page.page, pageSize: page.pageSize, total: page.total, totalPages: page.totalPages },
      { page: 1, pageSize: 25, total: 105, totalPages: 5 },
    );
  });

  // An empty filtered set returns no rows and therefore no total_count either.
  // Reading the count off row zero without a guard yields undefined rows out of
  // a NaN page count, which is the one way this shape breaks.
  test("survives a filter that matches nothing", async () => {
    const { pool } = fakePool({ [LIST]: [] });

    const page = await InvitationService.getInvitations(pool, 7, PAGING);

    assert.deepEqual(page.rows, []);
    assert.equal(page.total, 0);
    assert.equal(page.totalPages, 0);
  });

  test("passes the filters through to the procedure", async () => {
    const { pool, calls } = fakePool({ [LIST]: [] });

    await InvitationService.getInvitations(pool, 7, {
      ...PAGING,
      isEnrolled: 0,
      status: "A",
      sendStatus: "failed",
      search: "reyes",
    });

    assert.deepEqual(inputsFor(calls, LIST), {
      us01_user_id: 7,
      page: 1,
      page_size: 25,
      is_enrolled: 0,
      status: "A",
      send_status: "failed",
      search: "reyes",
    });
  });
});

// usp_del_enrollment_invitation and usp_upd_enrollment_invitation_resend take
// modified_by as an audit field, not as a filter. This lookup is the only
// company scoping either action has — without it an HR could revoke or resend
// another company's invitation by guessing an id.
describe("invitationService — the ownership guards", () => {
  test("revoke refuses an invitation the lookup does not return", async () => {
    const { pool, calls } = fakePool({ [BY_ID]: [] });

    await assert.rejects(
      () => InvitationService.revokeInvitation(pool, 7, 54),
      (error) => error.statusCode === 403 && /does not belong to your company/.test(error.message),
    );

    assert.ok(
      !calls.some((call) => call.procedure === REVOKE),
      "revoked an invitation it had refused",
    );
  });

  test("revoke goes ahead when the invitation is the caller's", async () => {
    const { pool, calls } = fakePool({
      [BY_ID]: [invitationRow()],
      [REVOKE]: [],
    });

    await InvitationService.revokeInvitation(pool, 7, 54);

    assert.deepEqual(inputsFor(calls, REVOKE), { invitation_id: 54, modified_by: 7 });
  });

  test("the lookup is scoped by the caller, not by the invitation alone", async () => {
    const { pool, calls } = fakePool({
      [BY_ID]: [invitationRow()],
      [REVOKE]: [],
    });

    await InvitationService.revokeInvitation(pool, 7, 54);

    assert.deepEqual(inputsFor(calls, BY_ID), { invitation_id: 54, us01_user_id: 7 });
  });

  test("resend refuses an invitation the lookup does not return", async () => {
    const { pool } = fakePool({ [BY_ID]: [] });

    await assert.rejects(
      () => InvitationService.resendInvitation(pool, 7, 54),
      (error) => error.statusCode === 403,
    );
  });
});

// The guard was written as `invitation.is_enrolled === 1` and was permanently
// false on this path: usp_sel_enrollment_invitation_by_id returns the flag as a
// BIT, which mssql hands back as a JavaScript boolean. The by-token procedure
// returns a bare INT for the same field, same name and same meaning.
//
// Both types are pinned here on purpose. Correct by coincidence is not correct,
// and the coincidence is one procedure rewrite away from ending.
describe("invitationService — resending to somebody already enrolled", () => {
  for (const enrolled of [true, 1]) {
    test(`refuses when is_enrolled arrives as ${typeof enrolled} ${enrolled}`, async () => {
      const { pool } = fakePool({
        [BY_ID]: [invitationRow({ is_enrolled: enrolled })],
      });

      await assert.rejects(
        () => InvitationService.resendInvitation(pool, 7, 54),
        (error) =>
          error.statusCode === 409 && /already submitted an enrollment/.test(error.message),
      );
    });
  }
});

describe("invitationService — starting a bulk send", () => {
  test("refuses an account with no company assigned", async () => {
    const { pool } = fakePool({ [EMPLOYERS]: [] });

    await assert.rejects(
      () => InvitationService.sendInvitations(pool, 7, [{ email_address: "ana@coforge.com" }]),
      (error) => error.statusCode === 403 && /No company is assigned/.test(error.message),
    );
  });

  // One upload at a time per user. Two running at once would interleave against
  // the already_invited guard, and the second would report addresses as
  // duplicates because the first had just created them.
  test("refuses a second upload while one is still running", async () => {
    const userId = 987654;
    const { pool } = fakePool(ABCC_CODES);

    const running = InvitationJobStore.createJob(userId, 10);

    try {
      await assert.rejects(
        () => InvitationService.sendInvitations(pool, userId, [{ email_address: "ana@abcc.com.ph" }]),
        (error) => error.statusCode === 409 && /already running/.test(error.message),
      );
    } finally {
      // Left behind, this job makes every later test for this user id fail, and
      // the store is module state shared across the file.
      InvitationJobStore.completeJob(running.id, { cancelled: true });
    }
  });
});

// Branch 6 of the onboarding effort: each row carries a class code and, for a
// company with affiliates, an affiliate code, matched against the company's
// codes read once before the job.
describe("invitationService — the codes of a bulk send", () => {
  test("matches against the first company's classes and its own affiliates only", async () => {
    const { pool, calls } = fakePool(ABCC_CODES);

    const answer = await InvitationService.sendInvitations(pool, 31, [
      { email_address: "a@alakor.com.ph", classification_code: "CLAS 4", affiliate_code: "ALAKOR" },
      { email_address: "b@quad.com.ph", classification_code: "CLASS 4", affiliate_code: "QUAD" },
    ]);

    // No row is valid, so no invitation is created and nothing is sent.
    assert.deepEqual(answer.rejected, [
      { email: "a@alakor.com.ph", status: "invalid", reason: 'Unknown classification code "CLAS 4"' },
      { email: "b@quad.com.ph", status: "invalid", reason: 'Unknown affiliate code "QUAD"' },
    ]);
    assert.equal(answer.submitted, 2);
    assert.equal(answer.total, 0);

    assert.equal(inputsFor(calls, CLASSES).employer_id, "5");
    assert.equal(inputsFor(calls, AFFILIATES).us01_user_id, 31);

    await settled(answer.jobId);
    assert.ok(!calls.some((call) => call.procedure === INSERT));
  });

  // The insert answers 50181 or 50209 when the class was retired, or the
  // affiliate deactivated, after the codes were read. The row is reported
  // with a reason, and no email is attempted for it.
  for (const [number, reason] of [
    [50181, "Classification is no longer available"],
    [50209, "Affiliate is no longer available"],
  ])
    test(`a row the insert refuses with ${number} is reported as invalid: ${reason}`, async () => {
      const { pool, calls } = fakePool({
        ...ABCC_CODES,
        [INSERT]: () => {
          throw sqlError(number);
        },
      });

      const answer = await InvitationService.sendInvitations(pool, 32, [
        { email_address: "juan@alakor.com.ph", classification_code: "class 4", affiliate_code: "alakor" },
      ]);
      const job = await settled(answer.jobId);

      // The matched ids reached the procedure.
      const sent = inputsFor(calls, INSERT);
      assert.equal(sent.classification_id, "54");
      assert.equal(sent.affiliate_id, "7");
      assert.equal(sent.employer_id, "5");

      assert.deepEqual(job.results, [{ email: "juan@alakor.com.ph", status: "invalid", reason }]);
      assert.equal(job.counts.invalid, 1);
      assert.equal(job.status, "completed");
    });

  // The company's own code is no affiliate: NULL reaches the procedure.
  test("a row under the company's own code reaches the insert with no affiliate", async () => {
    const { pool, calls } = fakePool({
      ...ABCC_CODES,
      [INSERT]: () => {
        throw sqlError(50181);
      },
    });

    const answer = await InvitationService.sendInvitations(pool, 33, [
      { email_address: "ana@abcc.com.ph", classification_code: "CLASS 1", affiliate_code: "ABCC" },
    ]);
    await settled(answer.jobId);

    assert.equal(inputsFor(calls, INSERT).classification_id, "51");
    assert.equal(inputsFor(calls, INSERT).affiliate_id, null);
  });
});

describe("invitationService — the template", () => {
  test("is the first company's codes, its own affiliates only, named after it", async () => {
    const { pool } = fakePool(ABCC_CODES);

    const { fileName, workbook } = await InvitationService.getTemplate(pool, 31);

    assert.equal(fileName, "invitations-ABCC.xlsx");

    const codes = workbook.getWorksheet("Codes");
    const affiliateCodes = [2, 3, 4].map((row) => codes.getCell(row, 4).value ?? null);
    assert.deepEqual(affiliateCodes, ["ABCC", "ALAKOR", null]);
  });

  test("refuses an account with no company assigned", async () => {
    const { pool } = fakePool({ [EMPLOYERS]: [] });

    await assert.rejects(
      () => InvitationService.getTemplate(pool, 7),
      (error) => error.statusCode === 403 && /No company is assigned/.test(error.message),
    );
  });
});
