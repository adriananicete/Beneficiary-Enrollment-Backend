import crypto from "crypto";
import { poolPromise } from "../config/db.js";
import InvitationModel from "../models/invitationModel.js";
import { AppError } from "../utils/AppError.js";
import { sendInvitationEmail } from "./emailService.js";
import { partitionEmails } from "../utils/partitionEmails.js";
import { chunk, delay, runWithConcurrency } from "../utils/concurrency.js";
import { MAX_PAGE_SIZE } from "../utils/parsePaging.js";
import InvitationJobStore from "./invitationJobStore.js";
import config from "../config/env.js";

// A batch is the checkpoint unit: the point where the circuit breaker is
// consulted. Speed comes from the concurrency inside it, not from the boundary.
const BATCH_SIZE = 20;

// One full batch of consecutive failures means the problem is not the
// addresses. Stopping there beats grinding through the rest.
const CIRCUIT_BREAK_AFTER = 20;

const MAX_SEND_ATTEMPTS = 3;

// Retry-After can legitimately be minutes; waiting that long inside a job that
// HR is watching is worse than failing the address and letting them resend.
const MAX_RETRY_WAIT_MS = 30 * 1000;

// 429 means slow down, 5xx means Graph is unwell — both are worth another go.
// A 4xx about the address itself will fail again no matter how often we ask.
const isRetryable = (error) =>
  error?.status === 429 || (error?.status >= 500 && error?.status < 600);

const sendWithRetry = async (payload) => {
  for (let attempt = 1; ; attempt++) {
    try {
      await sendInvitationEmail(payload);
      return;
    } catch (error) {
      if (!isRetryable(error) || attempt >= MAX_SEND_ATTEMPTS) throw error;

      const backoffMs = 2 ** (attempt - 1) * 500;
      const waitMs = error.retryAfterSeconds
        ? Math.min(error.retryAfterSeconds * 1000, MAX_RETRY_WAIT_MS)
        : backoffMs;

      console.warn("Retrying invitation email:", {
        to: payload.to,
        attempt,
        status: error.status,
        waitMs,
      });

      await delay(waitMs);
    }
  }
};

// Returns the status it recorded so the caller can judge the run as a whole.
// Never throws — a failure here is one address, not the job.
const processAddress = async (pool, jobId, userId, employer, email) => {
  const token = crypto.randomBytes(32).toString("hex");

  try {
    const invitationId = await InvitationModel.createInvitation(pool, {
      employer_id: employer.employer_id,
      email_address: email,
      token,
      created_by: userId,
    });

    try {
      await sendWithRetry({
        to: email,
        companyName: employer.company_name,
        enrollmentUrl: `${config.appUrl}?token=${token}`,
      });

      await recordSendStatus(pool, invitationId, "sent", null, userId);
      InvitationJobStore.appendResult(jobId, {
        email,
        status: "sent",
        invitationId,
      });

      return "sent";
    } catch (error) {
      console.error("Invitation email failed:", { email, invitationId, error });

      await recordSendStatus(pool, invitationId, "failed", error?.message, userId);
      InvitationJobStore.appendResult(jobId, {
        email,
        status: "email_failed",
        invitationId,
      });

      return "email_failed";
    }
  } catch (error) {
    const number = error.number ?? error.originalError?.number;

    if (number === 50064) {
      InvitationJobStore.appendResult(jobId, {
        email,
        status: "already_invited",
      });

      return "already_invited";
    }

    if (number === 50078) {
      // Kept separate from already_invited on purpose: one tells HR to
      // resend, the other tells them there is nothing left to do.
      InvitationJobStore.appendResult(jobId, {
        email,
        status: "already_enrolled",
      });

      return "already_enrolled";
    }

    console.error("Invitation creation failed:", { email, error });
    InvitationJobStore.appendResult(jobId, { email, status: "failed" });

    return "failed";
  }
};

// Runs after the response has already gone out, so nothing here may throw: an
// unhandled rejection would take the process down with it. Every failure is
// caught, recorded against the job, and the run continues to the next address.
const runInvitationJob = async (jobId, userId, employer, emails) => {
  try {
    const pool = await poolPromise;

    // An address failure is skipped; a systemic failure stops the run. Without
    // this, a Graph outage would burn through every address, mark them all
    // failed, and leave that many live invitations that were never delivered
    // and cannot be recovered by re-uploading — the already_invited guard
    // means a second upload skips them.
    let consecutiveFailures = 0;
    let cancelled = false;

    for (const batch of chunk(emails, BATCH_SIZE)) {
      // Checked at the boundary rather than per address, so a cancel never
      // lands between creating an invitation and sending its email.
      if (InvitationJobStore.isCancelRequested(jobId)) {
        cancelled = true;
        break;
      }

      const statuses = new Array(batch.length);

      await runWithConcurrency(
        batch,
        config.invitationConcurrency,
        async (email, index) => {
          statuses[index] = await processAddress(
            pool,
            jobId,
            userId,
            employer,
            email,
          );
        },
      );

      // Counted in submitted order rather than completion order, so the tally
      // does not shift with whichever concurrent send happens to finish first.
      for (const status of statuses) {
        if (status === "email_failed" || status === "failed") {
          consecutiveFailures += 1;
        } else {
          consecutiveFailures = 0;
        }
      }

      if (consecutiveFailures >= CIRCUIT_BREAK_AFTER) {
        throw new Error(
          `Stopped after ${consecutiveFailures} consecutive failures. The remaining addresses were not attempted.`,
        );
      }
    }

    InvitationJobStore.completeJob(jobId, { cancelled });
  } catch (error) {
    // Either the circuit breaker tripped, or something outside the per-address
    // handling broke — the pool, most likely. Either way the job is failed as a
    // whole rather than left sitting at "processing" forever.
    console.error("Invitation job failed:", { jobId, error });
    InvitationJobStore.completeJob(jobId, { error });
  }
};

const sendInvitations = async (userId, emails) => {
  const pool = await poolPromise;

  const employers = await InvitationModel.getEmployersByUser(pool, userId);
  if (employers.length === 0)
    throw new AppError("No company is assigned to your account", 403);

  const employer = employers[0];

  if (InvitationJobStore.hasRunningJob(userId))
    throw new AppError(
      "An invitation upload is already running. Wait for it to finish before starting another.",
      409,
    );

  // Rejected rows need no I/O, so they are known now and returned with the
  // acknowledgement — HR sees the bad rows while still looking at the upload.
  const { valid, rejected } = partitionEmails(emails);

  const job = InvitationJobStore.createJob(userId, valid.length);

  // Intentionally not awaited: the response goes out now and the sending
  // continues behind it. The catch is belt and braces; runInvitationJob
  // already swallows everything.
  runInvitationJob(job.id, userId, employer, valid).catch((error) =>
    console.error("Invitation job crashed:", { jobId: job.id, error }),
  );

  return {
    jobId: job.id,
    submitted: emails.length,
    total: valid.length,
    rejected,
  };
};

const getInvitationJobStatus = (userId, jobId, since = 0) => {
  const job = InvitationJobStore.getJob(jobId);
  if (!job) throw new AppError("Invitation job not found", 404);

  if (job.userId !== String(userId))
    throw new AppError("Invitation job does not belong to your company", 403);

  return {
    jobId: job.id,
    total: job.total,
    processed: job.processed,
    status: job.status,
    // True between the cancel request and the next batch boundary, so the
    // caller can show "cancelling" rather than an apparently ignored click.
    cancelRequested: job.cancelRequested,
    counts: { ...job.counts },
    // Defaults to 0, which returns the whole list — a caller that ignores the
    // cursor still gets correct results, just more of them each time.
    results: job.results.slice(since),
    nextCursor: job.results.length,
    error: job.error,
  };
};

const cancelInvitationJob = (userId, jobId) => {
  const job = InvitationJobStore.getJob(jobId);
  if (!job) throw new AppError("Invitation job not found", 404);

  if (job.userId !== String(userId))
    throw new AppError("Invitation job does not belong to your company", 403);

  if (job.status !== "processing")
    throw new AppError("That upload has already finished", 409);

  InvitationJobStore.requestCancel(jobId);

  // Still "processing" here on purpose — the run stops at the next batch
  // boundary, and saying otherwise would be a lie the caller acts on.
  return { jobId: job.id, status: job.status, cancelRequested: true };
};

// The token is the credential that opens the enrollment form as the invited
// person. The backend needs it to rebuild the link on resend; a browser never
// does, so it is stripped before the list leaves the server.
const getInvitations = async (userId, filters) => {
  const pool = await poolPromise;

  const invitations = await InvitationModel.getInvitationsByUser(
    pool,
    userId,
    filters,
  );

  // The procedure carries the total on every row via COUNT(*) OVER(), so it
  // comes back without a second query — but a filtered set with no matches
  // returns no rows at all, and therefore no count either. Defaulting to 0 is
  // what keeps an empty page from reporting `undefined` rows out of `NaN`.
  const total = invitations.length > 0 ? invitations[0].total_count : 0;

  // total_count is dropped from the rows because it is the same number repeated
  // on each one, and it is already in the envelope.
  const rows = invitations.map(
    ({ token, total_count, ...invitation }) => invitation,
  );

  return {
    rows,
    page: filters.page,
    pageSize: filters.pageSize,
    total,
    totalPages: Math.ceil(total / filters.pageSize),
  };
};

// The SP caps last_send_error at 500 characters; Graph errors carry the whole
// response body and can run longer than that.
const MAX_SEND_ERROR_LENGTH = 500;

// Recording the outcome must never turn a delivered email into a failed
// request, so this swallows its own errors and only logs them.
const recordSendStatus = async (pool, invitationId, sendStatus, errorMessage, userId) => {
  const lastSendError = errorMessage
    ? String(errorMessage).slice(0, MAX_SEND_ERROR_LENGTH)
    : null;

  try {
    await InvitationModel.updateSendStatus(
      pool,
      invitationId,
      sendStatus,
      lastSendError,
      userId,
    );
  } catch (error) {
    console.error("Failed to record invitation send status:", {
      invitationId,
      sendStatus,
      error,
    });
  }
};

// Revoke and resend identify an invitation by id, and this list is the only
// company scoping they have — `usp_del_enrollment_invitation` and
// `usp_upd_enrollment_invitation_resend` take `modified_by` as an audit field,
// not as a filter. Without this check an HR could revoke or resend another
// company's invitation by guessing an id.
//
// That is why paging the list could not simply be paged: at the default 25 the
// check would stop seeing invitations that exist, and every legitimate revoke
// beyond the first page would answer 403.
//
// So it walks the pages, bounded by the total the first page reports. It is a
// stopgap and the replacement is written up in DBA-REQUESTS.md — a by-id lookup
// scoped to the caller, which makes both of these one round trip. Worth doing:
// even before paging, both of them read every invitation in the company to
// check a single id.
const findOwnedInvitation = async (pool, userId, invitationId) => {
  const pageSize = MAX_PAGE_SIZE;
  let page = 1;
  let total = null;

  while (total === null || (page - 1) * pageSize < total) {
    const rows = await InvitationModel.getInvitationsByUser(pool, userId, {
      page,
      pageSize,
    });

    if (rows.length === 0) return null;

    total = rows[0].total_count;

    const match = rows.find(
      (i) => String(i.invitation_id) === String(invitationId),
    );
    if (match) return match;

    page += 1;
  }

  return null;
};

const revokeInvitation = async (userId, invitationId) => {
  const pool = await poolPromise;

  const invitation = await findOwnedInvitation(pool, userId, invitationId);
  if(!invitation)
    throw new AppError("Invitation does not belong to your company", 403);

  await InvitationModel.revokeInvitation(pool, invitationId, userId)
};

const resendInvitation = async (userId, invitationId) => {
  const pool = await poolPromise;
  const invitation = await findOwnedInvitation(pool, userId, invitationId);
  if(!invitation) throw new AppError('Invitation does not belong to your company', 403);

  // Truthy rather than `=== 1`. The procedure returns is_enrolled as a BIT,
  // which mssql hands back as a JavaScript boolean, so the strict comparison
  // against 1 was never true and this guard never fired. Written this way it
  // holds whether the column comes back as a boolean or as a number.
  if(invitation.is_enrolled) throw new AppError('This employee has already submitted an enrollment', 409);

  await InvitationModel.resendInvitation(pool, invitationId, userId);

  try {
        await sendInvitationEmail({
          to: invitation.email_address,
          companyName: invitation.company_name,
          enrollmentUrl: `${config.appUrl}?token=${invitation.token}`,
        });

        await recordSendStatus(pool, invitationId, "sent", null, userId);

        return { status: "sent"}
      } catch (error) {
        console.error("Invitation resend failed:", { email: invitation.email_address, invitationId, error });

        await recordSendStatus(pool, invitationId, "failed", error?.message, userId);

        return { status: "email_failed"}
      }
};


export default {
    sendInvitations,
    getInvitationJobStatus,
    cancelInvitationJob,
    getInvitations,
    revokeInvitation,
    resendInvitation
}