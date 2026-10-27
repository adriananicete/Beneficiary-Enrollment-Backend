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

const LIST = "usp_sel_enrollment_invitations_by_user";
const BY_ID = "usp_sel_enrollment_invitation_by_id";
const REVOKE = "usp_del_enrollment_invitation";
const EMPLOYERS = "sec.us08_usp_sel_employers_by_user";

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
      () => InvitationService.sendInvitations(pool, 7, ["ana@coforge.com"]),
      (error) => error.statusCode === 403 && /No company is assigned/.test(error.message),
    );
  });

  // One upload at a time per user. Two running at once would interleave against
  // the already_invited guard, and the second would report addresses as
  // duplicates because the first had just created them.
  test("refuses a second upload while one is still running", async () => {
    const userId = 987654;
    const { pool } = fakePool({
      [EMPLOYERS]: [{ employer_id: 1, company_name: "Coforge" }],
    });

    const running = InvitationJobStore.createJob(userId, 10);

    try {
      await assert.rejects(
        () => InvitationService.sendInvitations(pool, userId, ["ana@coforge.com"]),
        (error) => error.statusCode === 409 && /already running/.test(error.message),
      );
    } finally {
      // Left behind, this job makes every later test for this user id fail, and
      // the store is module state shared across the file.
      InvitationJobStore.completeJob(running.id, { cancelled: true });
    }
  });
});
