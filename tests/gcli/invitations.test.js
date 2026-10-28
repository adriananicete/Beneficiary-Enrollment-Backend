import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";
import { fakePool, inputsFor } from "../helpers/fakePool.js";
import { CREDIT_PLAN, LIMITS, useDevStore } from "../helpers/gcliStore.js";

const { partitionInvitations } = await import("../../src/utils/partitionInvitations.js");
const { default: InvitationService } = await import("../../src/services/invitationService.js");
const { default: InvitationJobStore } = await import("../../src/services/invitationJobStore.js");
const { savePlan } = await import("../../src/gcli/companies.js");

// A borrower of a credit company is not classified (docs/backend-handoff.md 2.12): HR's row
// for one carries an email, and a class code is neither asked for nor read.

const company = { employer_id: "5", company_code: "Bluepoint" };
const classes = [{ classification_id: "51", classification_code: "CLASS 1" }];

describe("partitionInvitations for a company that is not classified", () => {
  test("a row with no class code is valid, with no class", () => {
    const { valid, rejected } = partitionInvitations([{ email_address: "ana@bluepoint.example" }], {
      company,
      classes: [],
      affiliates: [],
      classified: false,
    });

    assert.deepEqual(rejected, []);
    assert.deepEqual(valid, [{ email: "ana@bluepoint.example", classificationId: null, affiliateId: null }]);
  });

  test("a class code in the row is not read, even an unknown one", () => {
    const { valid } = partitionInvitations(
      [{ email_address: "ana@bluepoint.example", classification_code: "NOPE" }, { email_address: "jun@bluepoint.example", classification_code: "CLASS 1" }],
      { company, classes, affiliates: [], classified: false },
    );

    assert.deepEqual(valid.map((row) => row.classificationId), [null, null]);
  });

  test("the other rules still hold: the email, a repeat, and the affiliate", () => {
    const { valid, rejected } = partitionInvitations(
      [{ email_address: "not an email" }, { email_address: "ana@bluepoint.example" }, { email_address: "ANA@bluepoint.example" }, { email_address: "jun@bluepoint.example", affiliate_code: "ALAKOR" }],
      { company, classes: [], affiliates: [], classified: false },
    );

    assert.deepEqual(valid.map((row) => row.email), ["ana@bluepoint.example"]);
    assert.deepEqual(rejected.map((row) => row.reason), ["Not a valid email address", "Repeated in this upload", "This company has no affiliates"]);
  });

  test("a company that is classified still has to name a class", () => {
    const { valid, rejected } = partitionInvitations([{ email_address: "ana@bluepoint.example" }], { company, classes, affiliates: [] });

    assert.deepEqual(valid, []);
    assert.deepEqual(rejected, [{ email: "ana@bluepoint.example", status: "invalid", reason: "Classification is required" }]);
  });
});

describe("a bulk send for a credit company", () => {
  useDevStore();

  const EMPLOYERS = "sec.us08_usp_sel_employers_by_user";
  const INSERT = "bes.usp_ins_enrollment_invitation";

  const answers = {
    [EMPLOYERS]: [{ employer_id: "5", company_code: "ABCC", company_name: "Abacus Book and Card Corporation" }],
    usp_sel_classifications_by_employer: [],
    usp_sel_employer_affiliates_by_user: [],
    // refused, so the job stops before it would send an email
    [INSERT]: () => {
      throw Object.assign(new Error("SQL 50181"), { number: 50181 });
    },
  };

  const settled = async (jobId) => {
    for (let i = 0; i < 200; i++) {
      const job = InvitationJobStore.getJob(jobId);
      if (job.status !== "processing") return job;
      await new Promise((resolve) => setImmediate(resolve));
    }
    throw new Error("the job never finished");
  };

  test("takes a row with no class, and the invitation is created with none", async () => {
    savePlan("5", { plan: CREDIT_PLAN, loan_limits: LIMITS });
    const { pool, calls } = fakePool(answers);

    const answer = await InvitationService.sendInvitations(pool, 41, [{ email_address: "ana@abcc.com.ph" }]);
    await settled(answer.jobId);

    assert.deepEqual(answer.rejected, []);
    assert.equal(answer.total, 1);
    assert.equal(inputsFor(calls, INSERT).classification_id, null);
    assert.equal(inputsFor(calls, INSERT).employer_id, "5");
  });

  test("a company on the standard plan is still refused a row with no class", async () => {
    const { pool, calls } = fakePool(answers);

    const answer = await InvitationService.sendInvitations(pool, 42, [{ email_address: "ana@abcc.com.ph" }]);

    assert.deepEqual(answer.rejected, [{ email: "ana@abcc.com.ph", status: "invalid", reason: "Classification is required" }]);
    assert.equal(answer.total, 0);
    assert.ok(!calls.some((call) => call.procedure === INSERT));
  });

  test("with the dev store off, a company stored as credit is classified as every company is", async () => {
    savePlan("5", { plan: CREDIT_PLAN, loan_limits: LIMITS });
    process.env.GCLI_DEV_STORE = "false";
    const { pool } = fakePool(answers);

    const answer = await InvitationService.sendInvitations(pool, 43, [{ email_address: "ana@abcc.com.ph" }]);

    assert.equal(answer.rejected[0].reason, "Classification is required");
  });
});
