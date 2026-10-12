import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";
import { callTo, fakePool, inputsFor } from "../helpers/fakePool.js";
import { AppError } from "../../src/utils/AppError.js";

const { default: ClaimService, asOpenClaimConflict } = await import(
  "../../src/services/claimService.js"
);

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

describe("asOpenClaimConflict", () => {
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
