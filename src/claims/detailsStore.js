import { AppError } from "../utils/AppError.js";
import { readStore, update as updateStore } from "../gcli/devStore.js";

// The details of a claim, and the state of its hand-off to the claims web app, before the
// database has a place for them (docs/claims-details/CLAIM-DETAILS-DBA-REQUEST.md). They live in
// the development store's file (src/gcli/devStore.js), under two keys of their own:
//
//   claimDetails    claim_id -> { details, insured, computed, coverage, saved_at }
//   claimTransfers  claim_id -> { status, queued_at, attempts, last_attempt_at, reference,
//                                 last_error, reader_user_id, claim_type_code }
//
// Only src/claims and the integration routes read or write them, and only while
// CLAIM_DETAILS_DEV_STORE=true. The store's own on/off check belongs to Group Credit Life and is
// not used here. When the DBA's procedures exist this module is what they replace.
//
// What the file holds is a claimant's name, number and the cause of a death, in plain text: use it
// on your own machine only. The server refuses to start with the switch on in production.

// Read at call time, not at import, so a test can switch it and put it back.
export const claimDetailsOn = () =>
  process.env.CLAIM_DETAILS_DEV_STORE === "true" && process.env.NODE_ENV !== "production";

export const assertClaimDetailsAllowed = () => {
  if (process.env.CLAIM_DETAILS_DEV_STORE === "true" && process.env.NODE_ENV === "production")
    throw new Error(
      "CLAIM_DETAILS_DEV_STORE=true is for development only: it keeps claim details and the hand-off state in a file, not in the database. Remove it from the production environment.",
    );
};

export const TRANSFER_STATUSES = ["QUEUED", "SENT", "FAILED"];

const now = () => new Date().toISOString();

// On Windows the store file is replaced by renaming a temporary file over it, and that answers EPERM
// or EBUSY for a moment when a virus scanner or the indexer has the old file open. Found by running
// the integration routes' tests while another process opened the file in a loop. The whole change is
// tried again, a few times, and the last failure is the one thrown; any other error is thrown at once.
const LOCKED = new Set(["EPERM", "EBUSY", "EACCES"]);
const ATTEMPTS = 5;

const pause = (milliseconds) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);

const update = (change) => {
  for (let attempt = 1; ; attempt++) {
    try {
      return updateStore(change);
    } catch (error) {
      if (attempt === ATTEMPTS || !LOCKED.has(error.code)) throw error;

      pause(25 * attempt);
    }
  }
};

// The store starts without these two keys, and the file of a developer who ran an earlier version
// has none: each is made when first needed.
const detailsIn = (store) => (store.claimDetails ??= {});
const transfersIn = (store) => (store.claimTransfers ??= {});

// Keeps the details, the insured, the computed facts and the coverage of a claim, replacing any
// kept before: a returned claim that is resubmitted has its details replaced.
export const saveDetails = (claimId, { details, insured, computed, coverage }) =>
  update((draft) => {
    detailsIn(draft)[String(claimId)] = { details, insured, computed, coverage, saved_at: now() };
  });

// The details object the API answers with, or null when the claim has none (it was filed with the
// switch off, or its type takes none).
export const getDetails = (claimId) => {
  const kept = readStore().claimDetails?.[String(claimId)];
  if (!kept) return null;

  return {
    claimant: kept.details.claimant,
    event: kept.details.event,
    condition: kept.details.condition,
    // a claim kept before the section existed has none
    ...(kept.details.agent_location ? { agent_location: kept.details.agent_location } : {}),
    insured: kept.insured,
    computed: kept.computed,
    coverage: kept.coverage,
  };
};

// An approved claim is queued once. `readerUserId` is the person who approved it: the integration
// has no signed-in user, and the existing read procedures are scoped to one, so it reads the claim
// as the person who approved it. `claimTypeCode` is kept so the list does not need a read per claim.
export const enqueueTransfer = (claimId, { readerUserId, claimTypeCode }) =>
  update((draft) => {
    const transfers = transfersIn(draft);
    const id = String(claimId);
    if (transfers[id]) return;

    transfers[id] = {
      status: "QUEUED",
      queued_at: now(),
      attempts: 0,
      last_attempt_at: null,
      reference: null,
      last_error: null,
      reader_user_id: String(readerUserId),
      claim_type_code: claimTypeCode ?? null,
    };
  });

const transferOf = (claimId, record) => ({ claim_id: String(claimId), ...record });

export const getTransfer = (claimId) => {
  const record = readStore().claimTransfers?.[String(claimId)];

  return record ? transferOf(claimId, record) : null;
};

// Claim ids are BIGINTs that arrive as text; compared as numbers they sort the way they were made.
const byClaimId = (a, b) => Number(a.claim_id) - Number(b.claim_id);

// The transfers in a state ("ALL" for every one), by claim id, starting after the claim `after`.
// `next_after` is the last id of the page when there is more, for the next call.
export const listTransfers = (status, limit, after) => {
  const all = Object.entries(readStore().claimTransfers ?? {})
    .map(([claimId, record]) => transferOf(claimId, record))
    .filter((transfer) => status === "ALL" || transfer.status === status)
    .filter((transfer) => after === undefined || Number(transfer.claim_id) > Number(after))
    .sort(byClaimId);

  const page = all.slice(0, limit);

  return { items: page, next_after: page.length < all.length ? (page.at(-1)?.claim_id ?? null) : null };
};

const NOT_QUEUED = "Claim not found";
const ALREADY_SENT = "This claim was already received under another reference";
const SENT_STAYS_SENT = "A claim that was received cannot be marked as failed";

// The claims web app's report. SENT again with the same reference is accepted and changes nothing,
// so a retry after a lost answer is safe; a different reference is a 409, and a SENT claim never
// goes back to FAILED. Anything else counts as an attempt.
export const recordTransfer = (claimId, status, reference, error) =>
  update((draft) => {
    const record = transfersIn(draft)[String(claimId)];
    if (!record) throw new AppError(NOT_QUEUED, 404);

    if (status === "SENT" && record.status === "SENT") {
      if (record.reference !== reference) throw new AppError(ALREADY_SENT, 409);

      return transferOf(claimId, record);
    }

    if (status === "FAILED" && record.status === "SENT") throw new AppError(SENT_STAYS_SENT, 409);

    record.status = status;
    record.attempts += 1;
    record.last_attempt_at = now();
    record.reference = status === "SENT" ? reference : record.reference;
    record.last_error = status === "FAILED" ? error : null;

    return transferOf(claimId, record);
  });

export default {
  claimDetailsOn,
  assertClaimDetailsAllowed,
  saveDetails,
  getDetails,
  enqueueTransfer,
  getTransfer,
  listTransfers,
  recordTransfer,
};
