import crypto from "crypto";

// A finished job is kept around long enough for the frontend to read the final
// results, then dropped. Progress is deliberately in memory only — the durable
// record of what happened to each address is send_status on the invitation row.
const JOB_TTL_MS = 15 * 60 * 1000;

const jobs = new Map();

const emptyCounts = () => ({
  sent: 0,
  email_failed: 0,
  already_invited: 0,
  failed: 0,
});

const createJob = (userId, total) => {
  const job = {
    id: crypto.randomUUID(),
    userId: String(userId),
    total,
    processed: 0,
    results: [],
    counts: emptyCounts(),
    status: "processing",
    error: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  jobs.set(job.id, job);
  return job;
};

// Ownership is checked by the caller, matching how revoke and resend do it, so
// "no such job" and "not yours" stay distinguishable.
const getJob = (jobId) => jobs.get(jobId) ?? null;

const hasRunningJob = (userId) => {
  for (const job of jobs.values()) {
    if (job.userId === String(userId) && job.status === "processing") return true;
  }

  return false;
};

const appendResult = (jobId, result) => {
  const job = jobs.get(jobId);
  if (!job) return;

  job.results.push(result);
  job.processed += 1;

  if (result.status in job.counts) job.counts[result.status] += 1;

  job.updatedAt = new Date();
};

const completeJob = (jobId, { error } = {}) => {
  const job = jobs.get(jobId);
  if (!job) return;

  job.status = error ? "failed" : "completed";
  job.error = error ? String(error.message || error) : null;
  job.updatedAt = new Date();

  // unref so a pending cleanup timer never holds the process open.
  setTimeout(() => jobs.delete(jobId), JOB_TTL_MS).unref();
};

export default {
  createJob,
  getJob,
  hasRunningJob,
  appendResult,
  completeJob,
};
