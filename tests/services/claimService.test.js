import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";
import { callTo, fakePool, inputsFor } from "../helpers/fakePool.js";
import { silenceConsoleError } from "../helpers/http.js";
import { fakeIo } from "../helpers/fakeIo.js";
import { AppError } from "../../src/utils/AppError.js";

const { default: ClaimService, asOpenClaimConflict, reviewDecisionOf } = await import(
  "../../src/services/claimService.js"
);
const { setRealtimeServer } = await import("../../src/realtime/realtime.js");

// The employee's claim submit and cancel. Everything covered here happens
// BEFORE the transaction opens: the refusals that decide whether anything is
// written. The transaction body is not driven, for the reason createEnrollment
// gives: a fake transaction agrees with whatever it is told. The manual run
// against TEST-CLAIM proves it.

const USER = "sec.us01_usp_sel_user_by_id";
const TYPES = "usp_sel_claim_types";
const INSERT = "usp_ins_claim";
const CANCEL = "usp_upd_claim_cancel";

// TEST-CLAIM as seeded, plus a second type with no required document. Ids as
// strings, as BigInt columns arrive.
const SEEDED = {
  types: [
    { claim_type_id: "1", claim_type_code: "TEST-CLAIM", claim_type_desc: "Test claim", ends_coverage: false },
    { claim_type_id: "4", claim_type_code: "NO-DOCS", claim_type_desc: "Nothing required", ends_coverage: false },
  ],
  requirements: [
    { requirement_id: "1", claim_type_id: "1", requirement_desc: "Test document (required)", is_required: true },
    { requirement_id: "2", claim_type_id: "1", requirement_desc: "Test document (optional)", is_required: false },
    { requirement_id: "7", claim_type_id: "4", requirement_desc: "Optional photo", is_required: false },
  ],
};

// mssql opens a transaction by calling the pool's acquire(). The fake answers
// it with this error, so a submission that passes every refusal ends here, and
// a test can tell "reached the transaction" from any other failure.
const REACHED_TRANSACTION = "reached the transaction";

const scripted = ({ user = { us01_user_id: "12", client_id: "75" } } = {}) => {
  const fake = fakePool({
    [USER]: user ? [user] : [],
    [TYPES]: () => ({ recordsets: [SEEDED.types, SEEDED.requirements], recordset: SEEDED.types }),
    [CANCEL]: [],
  });

  fake.pool.acquire = (transaction, callback) => callback(new Error(REACHED_TRANSACTION));

  return fake;
};

const reachedTransaction = (error) => error?.message === REACHED_TRANSACTION;

const doc = (field) => ({ field, fileName: "scan.pdf", content: Buffer.from("%PDF-"), mimeType: "application/pdf", byteSize: 5, sha256: "0".repeat(64) });

const submit = (pool, overrides = {}) =>
  ClaimService.submitClaim(pool, { userId: 12, claimTypeId: "1", documents: [doc("requirement_1")], ...overrides });

const refusedWith = (statusCode, message) => (error) =>
  error instanceof AppError && error.statusCode === statusCode && message.test(error.message);

describe("claimService.submitClaim — refused before anything is written", () => {
  // multipart sends text, but the route also takes JSON. {"toString": 1}
  // made String() throw on the logins and answered 500.
  test("a claim_type_id that is missing or not a whole number is 400, and the database is not asked", async () => {
    for (const claimTypeId of [undefined, null, "", "abc", "1.5", "-1", 1.5, {}, { toString: 1 }, ["1"], true]) {
      const { pool, calls } = scripted();

      await assert.rejects(
        submit(pool, { claimTypeId }),
        refusedWith(400, /^claim_type_id is required$/),
        JSON.stringify(claimTypeId),
      );
      assert.equal(calls.length, 0, JSON.stringify(claimTypeId));
    }
  });

  test("a number is accepted as well as text", async () => {
    const { pool } = scripted();

    await assert.rejects(submit(pool, { claimTypeId: 1 }), reachedTransaction);
  });

  // The control for every refusal below: the same submission, unbroken, gets
  // all the way to the transaction.
  test("a complete submission passes every refusal and reaches the transaction", async () => {
    const { pool } = scripted();

    await assert.rejects(submit(pool), reachedTransaction);
  });

  test("an account with no enrollment is 404, before the types are read", async () => {
    const { pool, calls } = scripted({ user: { us01_user_id: "12", client_id: null } });

    await assert.rejects(submit(pool), refusedWith(404, /No enrollment found/));
    assert.equal(callTo(calls, TYPES), undefined);
  });

  // The death claim is filed by HR, in a later branch. An employee must not
  // be able to reach an HR type by naming its id.
  test("only the employee's types are read", async () => {
    const { pool, calls } = scripted();

    await assert.rejects(submit(pool, { claimTypeId: "99" }));

    assert.equal(inputsFor(calls, TYPES).filed_by, "EMPLOYEE");
  });

  test("a type that is not in the employee's list is 400, and no claim is inserted", async () => {
    const { pool, calls } = scripted();

    await assert.rejects(submit(pool, { claimTypeId: "99" }), refusedWith(400, /^This claim type cannot be filed here$/));
    assert.equal(callTo(calls, INSERT), undefined);
  });

  test("a missing required document is 400 and names it", async () => {
    const { pool, calls } = scripted();

    await assert.rejects(
      submit(pool, { documents: [doc("requirement_2")] }),
      refusedWith(400, /^Missing required documents: Test document \(required\)$/),
    );
    assert.equal(callTo(calls, INSERT), undefined);
  });

  // Only the chosen type's requirements are matched. Requirement 7 belongs to
  // another type, so for type 1 it is a field nobody asked for.
  test("a document for another type's requirement is 400", async () => {
    const { pool } = scripted();

    await assert.rejects(
      submit(pool, { documents: [doc("requirement_1"), doc("requirement_7")] }),
      refusedWith(400, /^requirement_7 is not a document this claim type asks for$/),
    );
  });

  test("a type with no required document passes with no files", async () => {
    const { pool } = scripted();

    await assert.rejects(submit(pool, { claimTypeId: "4", documents: [] }), reachedTransaction);
  });
});

describe("claimService.cancelClaim", () => {
  // The client id comes from the user row. Nothing the caller sends reaches
  // @client_id, which is what scopes the cancel.
  test("is scoped by the caller's own client id, and records who cancelled", async () => {
    const { pool, calls } = scripted();

    await ClaimService.cancelClaim(pool, { userId: 12, claimId: "30", cancelRemarks: "filed by mistake" });

    assert.deepEqual(inputsFor(calls, CANCEL), {
      claim_id: "30",
      client_id: "75",
      cancelled_by: "12",
      cancel_remarks: "filed by mistake",
    });
  });

  test("an account with no enrollment is 404, and nothing is cancelled", async () => {
    const { pool, calls } = scripted({ user: { us01_user_id: "12", client_id: null } });

    await assert.rejects(
      ClaimService.cancelClaim(pool, { userId: 12, claimId: "30", cancelRemarks: null }),
      refusedWith(404, /No enrollment found/),
    );
    assert.equal(callTo(calls, CANCEL), undefined);
  });
});

const DETAIL = "usp_sel_claim_by_id";
const RESUBMIT = "usp_upd_claim_resubmit";
const REVIEW = "usp_upd_claim_review";

// usp_sel_claim_by_id's three result sets, for a claim of TEST-CLAIM.
const claimDetail = ({ claim, documents = [], requirements = SEEDED.requirements.slice(0, 2) } = {}) => () => ({
  recordsets: [claim ? [claim] : [], claim ? documents : [], claim ? requirements : []],
  recordset: claim ? [claim] : [],
});

const HEADER = {
  claim_id: "30",
  client_id: "75",
  employee_name: "Ana Reyes",
  email_address: "ana@coforge.com",
  claim_type_desc: "Test claim",
  claim_status: "RETURNED",
};

// The same fake pool, with the detail and the decision scripted, and a count
// of how many times a transaction was asked for.
const withClaim = ({ claim = HEADER, documents, reviewOutcome = [{ account_closed: false }] } = {}) => {
  const fake = fakePool({
    [USER]: [{ us01_user_id: "12", client_id: "75" }],
    [DETAIL]: claimDetail({ claim, documents }),
    [REVIEW]: reviewOutcome,
  });

  fake.transactions = 0;
  fake.pool.acquire = (transaction, callback) => {
    fake.transactions++;
    callback(new Error(REACHED_TRANSACTION));
  };

  return fake;
};

const resubmit = (pool, overrides = {}) =>
  ClaimService.resubmitClaim(pool, { userId: 12, claimId: "30", documents: [doc("requirement_2")], ...overrides });

describe("claimService.resubmitClaim — refused before anything is written", () => {
  test("no documents is 400, and the database is not asked", async () => {
    const { pool, calls } = withClaim();

    await assert.rejects(resubmit(pool, { documents: [] }), refusedWith(400, /^Add at least one document to resubmit$/));
    assert.equal(calls.length, 0);
  });

  // Another employee's claim comes back empty from the procedure.
  test("a claim the caller cannot see is 404", async () => {
    const fake = withClaim({ claim: null });

    await assert.rejects(resubmit(fake.pool), refusedWith(404, /^Claim not found$/));
    assert.equal(fake.transactions, 0);
  });

  test("a claim that is not RETURNED is 409, and no transaction opens", async () => {
    for (const claim_status of ["PENDING", "APPROVED", "REJECTED", "CANCELLED", "CLOSED"]) {
      const fake = withClaim({ claim: { ...HEADER, claim_status } });

      await assert.rejects(resubmit(fake.pool), refusedWith(409, /^Only a returned claim can be resubmitted$/), claim_status);
      assert.equal(fake.transactions, 0, claim_status);
    }
  });

  test("a required document neither on the claim nor sent is 400", async () => {
    const fake = withClaim({ documents: [] });

    await assert.rejects(resubmit(fake.pool), refusedWith(400, /^Missing required documents: Test document \(required\)$/));
    assert.equal(fake.transactions, 0);
  });

  // The control: the claim already has its required document, so adding the
  // optional one is enough.
  test("the documents the claim already has count, and it reaches the transaction", async () => {
    const fake = withClaim({ documents: [{ claim_document_id: "9", requirement_id: "1" }] });

    await assert.rejects(resubmit(fake.pool), reachedTransaction);
    assert.equal(fake.transactions, 1);
  });
});

describe("reviewDecisionOf — HR's decision, before the database", () => {
  test("approve with or without remarks; reject and return need them", () => {
    assert.deepEqual(reviewDecisionOf("APPROVED"), { status: "APPROVED", remarks: null });
    assert.deepEqual(reviewDecisionOf("APPROVED", "  ok  "), { status: "APPROVED", remarks: "ok" });
    assert.deepEqual(reviewDecisionOf("REJECTED", "Not covered"), { status: "REJECTED", remarks: "Not covered" });
    assert.deepEqual(reviewDecisionOf("RETURNED", "Add the medical certificate"), {
      status: "RETURNED",
      remarks: "Add the medical certificate",
    });
  });

  test("anything but the three statuses is 400", () => {
    for (const status of [undefined, null, "", "approved", "PENDING", "CANCELLED", "CLOSED", 1, {}, ["APPROVED"]])
      assert.throws(
        () => reviewDecisionOf(status, "x"),
        (error) => error.statusCode === 400 && /^Status must be APPROVED, REJECTED or RETURNED$/.test(error.message),
        JSON.stringify(status),
      );
  });

  // The remarks are the only thing that tells the employee what to fix.
  test("rejecting or returning without remarks is 400, blank counting as none", () => {
    for (const status of ["REJECTED", "RETURNED"])
      for (const remarks of [undefined, null, "", "   "])
        assert.throws(
          () => reviewDecisionOf(status, remarks),
          (error) => error.statusCode === 400 && /required to reject or return/.test(error.message),
          `${status} ${JSON.stringify(remarks)}`,
        );
  });

  test("remarks that are not text are 400, for any status", () => {
    for (const remarks of [1, true, {}, ["x"], { toString: 1 }])
      assert.throws(() => reviewDecisionOf("APPROVED", remarks), (error) => error.statusCode === 400, JSON.stringify(remarks));
  });

  // The column is varchar(500). Pinned as a literal.
  test("500 characters of remarks is accepted and 501 is 400", () => {
    assert.equal(reviewDecisionOf("REJECTED", "x".repeat(500)).remarks.length, 500);
    assert.throws(() => reviewDecisionOf("REJECTED", "x".repeat(501)), (error) => error.statusCode === 400);
  });
});

describe("claimService.reviewClaim", () => {
  const realFetch = globalThis.fetch;
  let restoreConsole = () => {};

  afterEach(() => {
    globalThis.fetch = realFetch;
    restoreConsole();
  });

  const ok = (body = {}) => ({ ok: true, status: 200, json: async () => body, text: async () => "", headers: { get: () => null } });

  // Records every message sent. The token answer expires at once, so nothing
  // is cached between tests.
  const stubMail = ({ send = ok() } = {}) => {
    const sent = [];

    globalThis.fetch = async (url, options) => {
      if (/login\.microsoftonline\.com/.test(String(url))) return ok({ access_token: "tok", expires_in: 0 });

      sent.push(JSON.parse(options.body).message);
      return send;
    };

    return sent;
  };

  const PENDING = { ...HEADER, claim_status: "PENDING" };

  const review = (pool, overrides = {}) =>
    ClaimService.reviewClaim(pool, { userId: 3, claimId: "30", status: "APPROVED", remarks: null, ...overrides });

  // Read first: another company's claim is refused before the procedure runs,
  // and nobody is emailed.
  test("a claim the caller cannot see is 404; nothing is decided and nobody is emailed", async () => {
    const sent = stubMail();
    const { pool, calls } = withClaim({ claim: null });

    await assert.rejects(review(pool), refusedWith(404, /^Claim not found$/));
    assert.equal(callTo(calls, REVIEW), undefined);
    assert.equal(sent.length, 0);
  });

  test("the decision reaches the procedure as the reviewer, the status and the remarks", async () => {
    stubMail();
    const { pool, calls } = withClaim({ claim: PENDING });

    await review(pool, { status: "RETURNED", remarks: "Add the medical certificate" });

    assert.deepEqual(inputsFor(calls, REVIEW), {
      claim_id: "30",
      us01_user_id: 3,
      decision: "RETURNED",
      review_remarks: "Add the medical certificate",
    });
  });

  test("the employee is emailed at the address read before the decision", async () => {
    const sent = stubMail();
    const { pool } = withClaim({ claim: PENDING });

    await review(pool, { status: "REJECTED", remarks: "Not covered" });

    assert.equal(sent.length, 1);
    assert.equal(sent[0].toRecipients[0].emailAddress.address, "ana@coforge.com");
    assert.equal(sent[0].subject, "Your claim was not approved");
    assert.match(sent[0].body.content, /Hi Ana Reyes,/);
    assert.match(sent[0].body.content, /Not covered/);
  });

  // account_closed is a BIT, which the driver hands back as a boolean.
  test("an approval that closed the account says so, in the result and in the email", async () => {
    for (const closed of [true, 1]) {
      const sent = stubMail();
      const { pool } = withClaim({ claim: PENDING, reviewOutcome: [{ account_closed: closed }] });

      assert.deepEqual(await review(pool), { accountClosed: true }, String(closed));
      assert.match(sent[0].body.content, /your account on this\s+system has been closed/);
      assert.doesNotMatch(sent[0].body.content, /Sign in/);
    }
  });

  // The procedure closed the account and ended its sessions. Its open sockets
  // close at once (branch 9), and only then.
  test("an approval that closed the account disconnects the employee's sockets", async () => {
    stubMail();
    const { io, events } = fakeIo();
    setRealtimeServer(io);

    try {
      await review(withClaim({ claim: PENDING, reviewOutcome: [{ account_closed: true }] }).pool);
      assert.deepEqual(events, [{ kind: "disconnect", room: "client:75", close: true }]);

      events.length = 0;
      await review(withClaim({ claim: PENDING, reviewOutcome: [{ account_closed: false }] }).pool);
      assert.deepEqual(events, []);
    } finally {
      setRealtimeServer(null);
    }
  });

  test("an approval that did not close the account says nothing of it", async () => {
    for (const closed of [false, 0, undefined]) {
      const sent = stubMail();
      const { pool } = withClaim({ claim: PENDING, reviewOutcome: [{ account_closed: closed }] });

      assert.deepEqual(await review(pool), { accountClosed: false }, String(closed));
      assert.doesNotMatch(sent[0].body.content, /has been closed/);
      assert.match(sent[0].body.content, /Sign in/);
    }
  });

  // HR decided, and the record says so whether or not Microsoft was reachable.
  test("a failed email does not undo or fail the decision", async () => {
    restoreConsole = silenceConsoleError();
    stubMail({ send: { ok: false, status: 503, text: async () => "down", headers: { get: () => null } } });
    const { pool, calls } = withClaim({ claim: PENDING });

    assert.deepEqual(await review(pool), { accountClosed: false });
    assert.ok(callTo(calls, REVIEW));
  });

  test("a claim with no email address is decided, and nobody is emailed", async () => {
    restoreConsole = silenceConsoleError();
    const sent = stubMail();
    const { pool } = withClaim({ claim: { ...PENDING, email_address: null } });

    await review(pool);

    assert.equal(sent.length, 0);
  });
});

// The death claim, branch 6. Filed by HR for an employee already marked
// deceased, approved on filing.
const ENROLLMENT = "usp_get_insurance_enrollment_by_id";
const CLOSE = "usp_upd_claim_close";

// TEST-DEATH as seeded by request 21: type 3, requirement 4.
const HR_TYPES = {
  types: [{ claim_type_id: "3", claim_type_code: "TEST-DEATH", claim_type_desc: "Test death claim", ends_coverage: true }],
  requirements: [
    { requirement_id: "4", claim_type_id: "3", requirement_desc: "Test death certificate (required)", is_required: true },
  ],
};

const deathScripted = ({ enrollment = { client_id: "75", date_of_death: "2026-10-01" } } = {}) => {
  const fake = fakePool({
    [ENROLLMENT]: enrollment ? [enrollment] : [],
    [TYPES]: () => ({ recordsets: [HR_TYPES.types, HR_TYPES.requirements], recordset: HR_TYPES.types }),
  });

  fake.transactions = 0;
  fake.pool.acquire = (transaction, callback) => {
    fake.transactions++;
    callback(new Error(REACHED_TRANSACTION));
  };

  return fake;
};

const fileDeath = (pool, overrides = {}) =>
  ClaimService.fileDeathClaim(pool, {
    userId: 3,
    roleName: "HR",
    clientId: "75",
    claimTypeId: "3",
    documents: [doc("requirement_4")],
    ...overrides,
  });

describe("claimService.fileDeathClaim — refused before anything is written", () => {
  test("a claim_type_id that is not a whole number is 400, and the database is not asked", async () => {
    const { pool, calls } = deathScripted();

    await assert.rejects(fileDeath(pool, { claimTypeId: { toString: 1 } }), refusedWith(400, /^claim_type_id is required$/));
    assert.equal(calls.length, 0);
  });

  test("an employee with no active enrollment is 404", async () => {
    const fake = deathScripted({ enrollment: null });

    await assert.rejects(fileDeath(fake.pool), refusedWith(404, /^Enrollment not found$/));
    assert.equal(fake.transactions, 0);
  });

  // The order is decided: mark deceased first, then file.
  test("an employee not marked deceased is 409, before the types are read and before any write", async () => {
    const fake = deathScripted({ enrollment: { client_id: "75", date_of_death: null } });

    await assert.rejects(fileDeath(fake.pool), refusedWith(409, /^This employee is not marked deceased$/));
    assert.equal(callTo(fake.calls, TYPES), undefined);
    assert.equal(fake.transactions, 0);
  });

  // HR cannot file an employee's claim type by naming its id.
  test("only HR's types are read, and an employee's type is 400", async () => {
    const fake = deathScripted();

    await assert.rejects(fileDeath(fake.pool, { claimTypeId: "1" }), refusedWith(400, /^This claim type cannot be filed here$/));
    assert.equal(inputsFor(fake.calls, TYPES).filed_by, "HR");
    assert.equal(fake.transactions, 0);
  });

  test("a missing death certificate is 400 and names it", async () => {
    const fake = deathScripted();

    await assert.rejects(
      fileDeath(fake.pool, { documents: [] }),
      refusedWith(400, /^Missing required documents: Test death certificate \(required\)$/),
    );
    assert.equal(fake.transactions, 0);
  });

  test("a complete filing for a deceased employee reaches the transaction", async () => {
    const fake = deathScripted();

    await assert.rejects(fileDeath(fake.pool), reachedTransaction);
    assert.equal(fake.transactions, 1);
  });
});

describe("claimService.closeDeathClaim", () => {
  // account_closed is a BIT, which the driver hands back as a boolean; a
  // procedure that computes it may hand back 1. Both mean closed.
  test("closes the claim as the caller, and disconnects the employee's sockets", async () => {
    for (const closed of [true, 1]) {
      const { io, events } = fakeIo();
      setRealtimeServer(io);

      try {
        const { pool, calls } = fakePool({ [CLOSE]: [{ claim_id: "40", client_id: "75", account_closed: closed }] });

        assert.deepEqual(await ClaimService.closeDeathClaim(pool, { userId: 3, claimId: "40" }), { accountClosed: true }, String(closed));
        assert.deepEqual(inputsFor(calls, CLOSE), { claim_id: "40", us01_user_id: 3 });
        assert.deepEqual(events, [{ kind: "disconnect", room: "client:75", close: true }], String(closed));
      } finally {
        setRealtimeServer(null);
      }
    }
  });

  test("a refused close disconnects nobody", async () => {
    const { io, events } = fakeIo();
    setRealtimeServer(io);

    try {
      const { pool } = fakePool({
        [CLOSE]: () => {
          throw Object.assign(new Error("No death claim found."), { number: 50167 });
        },
      });

      await assert.rejects(ClaimService.closeDeathClaim(pool, { userId: 3, claimId: "40" }));
      assert.deepEqual(events, []);
    } finally {
      setRealtimeServer(null);
    }
  });
});

describe("asOpenClaimConflict", () => {
  // The death claim's race names itself in HR's words, not the employee's.
  test("the sentence can be the caller's own", () => {
    assert.equal(
      asOpenClaimConflict({ number: 2601 }, "A death claim has already been filed for this employee").message,
      "A death claim has already been filed for this employee",
    );
  });

  // UX_claims_open is a unique INDEX, so a race past the procedure's own 50152
  // check raises 2601, which used to be unmapped.
  test("2601 becomes the open-claim 409, at the top or one level down", () => {
    for (const error of [{ number: 2601 }, { originalError: { number: 2601 } }]) {
      const translated = asOpenClaimConflict(error);

      assert.ok(translated instanceof AppError);
      assert.equal(translated.statusCode, 409);
      assert.equal(translated.message, "You already have an open claim of this type");
    }
  });

  test("anything else passes through untouched", () => {
    for (const error of [{ number: 2627 }, { number: 50152 }, new AppError("x", 400), new Error("boom"), undefined]) {
      assert.equal(asOpenClaimConflict(error), error);
    }
  });
});
