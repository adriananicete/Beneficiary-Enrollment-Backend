// Import-safe despite living in services: this module imports node:crypto and
// nothing else. It holds the state of a running invitation upload entirely in
// memory — the durable record of what happened to each address is send_status
// on the invitation row.
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import InvitationJobStore from "../../src/services/invitationJobStore.js";

// The module keeps one Map for the process, so every test uses its own user id
// and works from the job it created rather than from a shared fixture.
let nextUser = 0;
const newUser = () => `user-${nextUser++}`;

describe("createJob", () => {
  test("starts processing with everything at zero", () => {
    const job = InvitationJobStore.createJob(newUser(), 3);

    assert.equal(job.status, "processing");
    assert.equal(job.total, 3);
    assert.equal(job.processed, 0);
    assert.deepEqual(job.results, []);
    assert.equal(job.cancelRequested, false);
    assert.equal(job.error, null);
  });

  test("counts every status the run can produce", () => {
    // A status missing from this list would still raise `processed` while its
    // own count silently stayed at zero, so the totals would stop adding up.
    const job = InvitationJobStore.createJob(newUser(), 0);

    assert.deepEqual(Object.keys(job.counts).sort(), [
      "already_enrolled",
      "already_invited",
      "email_failed",
      "failed",
      "sent",
    ]);
  });

  test("the user id is stored as a string", () => {
    // It is compared against another user id later, and one side arriving as a
    // BigInt string from the database is exactly how that comparison fails.
    const job = InvitationJobStore.createJob(42, 1);

    assert.equal(job.userId, "42");
  });
});

describe("appendResult", () => {
  test("records the result and raises processed", () => {
    const job = InvitationJobStore.createJob(newUser(), 2);

    InvitationJobStore.appendResult(job.id, { email: "a@x.com", status: "sent" });

    assert.equal(job.processed, 1);
    assert.equal(job.counts.sent, 1);
    assert.deepEqual(job.results[0], { email: "a@x.com", status: "sent" });
  });

  test("buckets each outcome separately", () => {
    const job = InvitationJobStore.createJob(newUser(), 4);

    for (const status of ["sent", "sent", "already_invited", "already_enrolled"]) {
      InvitationJobStore.appendResult(job.id, { email: "x@x.com", status });
    }

    assert.equal(job.processed, 4);
    assert.equal(job.counts.sent, 2);
    assert.equal(job.counts.already_invited, 1);
    assert.equal(job.counts.already_enrolled, 1);
    assert.equal(job.counts.failed, 0);
  });

  test("an unknown status still counts as processed", () => {
    // Deliberate: the run must not stall because a status was misspelled, but
    // the totals then disagree, which is the visible symptom of that mistake.
    const job = InvitationJobStore.createJob(newUser(), 1);

    InvitationJobStore.appendResult(job.id, { email: "x@x.com", status: "mystery" });

    assert.equal(job.processed, 1);
    assert.equal(
      Object.values(job.counts).reduce((sum, n) => sum + n, 0),
      0,
    );
  });

  test("a result for a job that no longer exists is ignored, not thrown", () => {
    // The run outlives the job's TTL in the worst case, and an unhandled
    // rejection in that loop would take the process down.
    assert.doesNotThrow(() =>
      InvitationJobStore.appendResult("no-such-job", { status: "sent" }),
    );
  });
});

describe("hasRunningJob", () => {
  test("true only while a job of that user is still processing", () => {
    const userId = newUser();
    const job = InvitationJobStore.createJob(userId, 1);

    assert.equal(InvitationJobStore.hasRunningJob(userId), true);

    InvitationJobStore.completeJob(job.id);

    assert.equal(InvitationJobStore.hasRunningJob(userId), false);
  });

  test("one user's running job does not block another", () => {
    const mine = newUser();
    const theirs = newUser();

    InvitationJobStore.createJob(mine, 1);

    assert.equal(InvitationJobStore.hasRunningJob(theirs), false);
  });
});

describe("cancelling", () => {
  test("cancel is a request, not an act", () => {
    // The run reads it at the next batch boundary, so the job stays
    // "processing" for a short while after HR asks. The screen should say
    // stopping rather than stopped until the status agrees.
    const job = InvitationJobStore.createJob(newUser(), 5);

    InvitationJobStore.requestCancel(job.id);

    assert.equal(InvitationJobStore.isCancelRequested(job.id), true);
    assert.equal(job.status, "processing");
  });

  test("isCancelRequested is false for a job that does not exist", () => {
    assert.equal(InvitationJobStore.isCancelRequested("no-such-job"), false);
  });
});

describe("completeJob", () => {
  test("a clean run completes", () => {
    const job = InvitationJobStore.createJob(newUser(), 1);

    InvitationJobStore.completeJob(job.id);

    assert.equal(job.status, "completed");
    assert.equal(job.error, null);
  });

  test("an error fails it and keeps the message", () => {
    const job = InvitationJobStore.createJob(newUser(), 1);

    InvitationJobStore.completeJob(job.id, { error: new Error("Graph is down") });

    assert.equal(job.status, "failed");
    assert.equal(job.error, "Graph is down");
  });

  test("cancelled wins over failed when both are given", () => {
    // Calling it "failed" would tell HR something went wrong when they are the
    // ones who stopped it.
    const job = InvitationJobStore.createJob(newUser(), 1);

    InvitationJobStore.completeJob(job.id, {
      cancelled: true,
      error: new Error("stopped mid-batch"),
    });

    assert.equal(job.status, "cancelled");
  });

  test("completing a job that does not exist is ignored, not thrown", () => {
    assert.doesNotThrow(() => InvitationJobStore.completeJob("no-such-job"));
  });
});

describe("getJob", () => {
  test("returns null rather than undefined for a job that does not exist", () => {
    // The controller distinguishes "no such job" from "not yours", so this has
    // to be a value it can test rather than an absence.
    assert.equal(InvitationJobStore.getJob("no-such-job"), null);
  });
});
