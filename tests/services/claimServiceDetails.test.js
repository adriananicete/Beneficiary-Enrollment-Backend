import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import "../helpers/env.js";
import { callTo, fakePool, inputsFor } from "../helpers/fakePool.js";
import { fakeTransactions, restoreTransactions } from "../helpers/fakeTransaction.js";
import { useClaimStore } from "../helpers/claimStore.js";
import { silenceConsoleError } from "../helpers/http.js";
import { AppError } from "../../src/utils/AppError.js";

const { default: ClaimService } = await import("../../src/services/claimService.js");
const { sql } = await import("../../src/config/db.js");
const { getDetails, getTransfer } = await import("../../src/claims/detailsStore.js");

// What claimService does with the details of a claim (src/claims/claimDetails.js): checked and
// worked out before anything is written, kept after the claim exists, and a transfer queued when a
// claim is approved. The whole transaction runs here against a fake pool (helpers/fakeTransaction.js),
// because what matters is what happens after it commits.
//
// With CLAIM_DETAILS_DEV_STORE off none of it happens, and the last block shows the service doing
// exactly what it did before.

const USER = "sec.us01_usp_sel_user_by_id";
const TYPES = "bes.usp_sel_claim_types";
const ENROLLMENT = "bes.usp_get_insurance_enrollment_by_id";
const BENEFITS = "bes.usp_get_enrollment_benefits_by_id";
const INSERT = "bes.usp_ins_claim";
const DOCUMENT = "bes.usp_ins_claim_document";
const DETAIL = "bes.usp_sel_claim_by_id";
const REVIEW = "bes.usp_upd_claim_review";

const EMPLOYEE_TYPES = {
  types: [
    { claim_type_id: "10", claim_type_code: "DEATH", claim_type_desc: "Death claim", ends_coverage: true },
    { claim_type_id: "11", claim_type_code: "TPD", claim_type_desc: "Total and Permanent Disability", ends_coverage: true },
    { claim_type_id: "1", claim_type_code: "NO-DOCS", claim_type_desc: "Test claim", ends_coverage: false },
  ],
  requirements: [
    { requirement_id: "91", claim_type_id: "10", requirement_desc: "Death certificate", is_required: true },
    { requirement_id: "92", claim_type_id: "11", requirement_desc: "Claim form", is_required: true },
    { requirement_id: "1", claim_type_id: "1", requirement_desc: "Test document", is_required: true },
  ],
};

// The death claim HR files: HR's own list.
const HR_TYPES = {
  types: [{ claim_type_id: "20", claim_type_code: "DEATH", claim_type_desc: "Death claim", ends_coverage: true }],
  requirements: [{ requirement_id: "95", claim_type_id: "20", requirement_desc: "Death certificate", is_required: true }],
};

const ENROLLMENT_ROW = {
  client_id: "75",
  enrollment_id: "76",
  first_name: "Maria",
  middle_name: "Reyes",
  last_name: "Santos",
  suffix: "",
  birthdate: "1991-03-14",
  gender: "F",
  company_name: "Acme Holdings Inc.",
  policy_no: "G-TLI-26-177",
  classification_desc: "Rank and file",
  enrollment_date: new Date(2026, 0, 5, 9, 0),
  date_of_death: null,
};

const BENEFIT_ROWS = [
  { benefit_name: "GTLIP", benefit_description: "Group Term Life Insurance Plan", coverage_amount: 500000, coverage_formula: null },
];

const DEATH_DETAILS = {
  claimant: { name: "Carlos Santos", relationship: "SPOUSE", contact_no: "09171234567", email_address: "carlos@example.com" },
  event: { date: "2026-03-01", place: "Pasay City" },
  condition: { immediate_cause: "Myocardial infarction", manner_of_death: "NATURAL", covid_related: "NO" },
};

const TPD_DETAILS = {
  claimant: { name: "Maria Santos", relationship: "SELF", contact_no: "09171234567" },
  event: { date: "2026-03-10" },
  condition: { disabling_condition: "Loss of use of both legs", cause: "ACCIDENT" },
};

const HEADER = {
  claim_id: "30",
  client_id: "75",
  employee_name: "Maria Reyes Santos",
  claim_type_id: "11",
  claim_type_code: "TPD",
  claim_type_desc: "Total and Permanent Disability",
  claim_status: "PENDING",
  filed_date: new Date(2026, 4, 20, 10, 0),
};

const scripted = ({ enrollment = ENROLLMENT_ROW, insert, header = HEADER } = {}) =>
  fakePool({
    [USER]: [{ us01_user_id: "12", client_id: "75" }],
    [TYPES]: (inputs) => {
      const found = inputs.filed_by === "HR" ? HR_TYPES : EMPLOYEE_TYPES;
      return { recordsets: [found.types, found.requirements], recordset: found.types };
    },
    [ENROLLMENT]: enrollment ? [enrollment] : [],
    [BENEFITS]: BENEFIT_ROWS,
    [INSERT]: insert ?? [{ claim_id: "30", enrollment_id: "76" }],
    [DOCUMENT]: [{ claim_document_id: "1" }],
    "bes.usp_chk_claim_requirements": [],
    "bes.usp_upd_claim_file_death": [],
    "bes.usp_upd_claim_resubmit": [],
    [DETAIL]: () => ({
      recordsets: [[header], [], EMPLOYEE_TYPES.requirements.filter((r) => r.claim_type_id === header.claim_type_id)],
      recordset: [header],
    }),
    [REVIEW]: [{ account_closed: false }],
  });

const doc = (field) => ({
  field,
  fileName: "scan.pdf",
  content: Buffer.from("%PDF-"),
  mimeType: "application/pdf",
  byteSize: 5,
  sha256: "0".repeat(64),
});

const json = (value) => JSON.stringify(value);

const submit = (pool, overrides = {}) =>
  ClaimService.submitClaim(pool, {
    userId: 12,
    claimTypeId: "10",
    documents: [doc("requirement_91")],
    details: json(DEATH_DETAILS),
    ...overrides,
  });

const refusedWith = (statusCode, message) => (error) =>
  error instanceof AppError && error.statusCode === statusCode && message.test(error.message);

let restoreConsole;

beforeEach(() => {
  restoreConsole = silenceConsoleError();
});

afterEach(() => {
  restoreTransactions();
  restoreConsole();
});

describe("filing a claim with the details switch on", () => {
  const store = useClaimStore();

  test("the claim is created and its details are kept beside it, worked out from the enrollment", async () => {
    const fake = scripted();
    const log = fakeTransactions(sql, fake.pool);

    const { claimId } = await submit(fake.pool);

    assert.equal(claimId, "30");
    assert.equal(log.committed, 1);

    const kept = getDetails("30");

    assert.deepEqual(kept.claimant, DEATH_DETAILS.claimant);
    assert.deepEqual(kept.event, DEATH_DETAILS.event);
    assert.deepEqual(kept.condition, DEATH_DETAILS.condition);
    assert.deepEqual(kept.insured, {
      client_id: "75",
      enrollment_id: "76",
      full_name: "Maria Reyes Santos",
      birthdate: "1991-03-14",
      gender: "F",
      company_code: null,
      company_name: "Acme Holdings Inc.",
      policy_no: "G-TLI-26-177",
      classification: "Rank and file",
      effective_date: "2026-01-05",
    });
    // 2026-01-05 to 2026-03-01 is 55 days, and she turns 35 on 14 March.
    assert.equal(kept.computed.age_at_event, 34);
    assert.equal(kept.computed.years_of_membership, 0.2);
    assert.equal(kept.computed.membership_band, "LESS_THAN_2");
    assert.equal(kept.computed.contestability, "CONTESTABLE");
    assert.equal(kept.computed.event_before_coverage, false);
    assert.equal(kept.computed.event_year, 2026);
    assert.deepEqual(kept.coverage, [
      { code: "GTLIP", description: "Group Term Life Insurance Plan", amount: 500000, formula: null },
    ]);

    // An employee's claim is PENDING: nothing is queued until HR approves it.
    assert.equal(getTransfer("30"), null);
    assert.ok(fs.existsSync(store.file));
  });

  // The id comes from the user row. A client id, or an insured, in the request is not read at all.
  test("the insured is the signed-in employee's own client, never one from the request", async () => {
    const fake = scripted();
    fakeTransactions(sql, fake.pool);

    await assert.rejects(
      submit(fake.pool, { details: json({ ...DEATH_DETAILS, insured: { client_id: "999" } }) }),
      (error) => Object.keys(error.errors).join() === "insured",
    );

    await submit(fake.pool, { clientId: "999" });

    assert.equal(inputsFor(fake.calls, ENROLLMENT).client_id, "75");
    assert.equal(inputsFor(fake.calls, BENEFITS).client_id, "75");
    assert.equal(inputsFor(fake.calls, INSERT).client_id, "75");
    assert.equal(getDetails("30").insured.client_id, "75");
  });

  test("details that break a rule are 400 with every field named, and nothing is written", async () => {
    const fake = scripted();
    const log = fakeTransactions(sql, fake.pool);
    const bad = { ...DEATH_DETAILS, claimant: { ...DEATH_DETAILS.claimant, name: "" }, event: { date: "2999-01-01" } };

    await assert.rejects(submit(fake.pool, { details: json(bad) }), (error) => {
      assert.ok(refusedWith(400, /^Enter the claimant's name\.$/)(error), error.message);
      assert.deepEqual(Object.keys(error.errors).sort(), ["claimant.name", "event.date"]);
      return true;
    });

    assert.equal(log.begun, 0);
    assert.equal(callTo(fake.calls, INSERT), undefined);
    assert.equal(fs.existsSync(store.file), false);
  });

  test("a type that needs details and gets none is 400 on details", async () => {
    const fake = scripted();
    const log = fakeTransactions(sql, fake.pool);

    for (const details of [undefined, "", "   "])
      await assert.rejects(submit(fake.pool, { details }), (error) => {
        assert.deepEqual(Object.keys(error.errors), ["details"]);
        return true;
      });

    assert.equal(log.begun, 0);
  });

  test("details that are not JSON, or are too long, are 400 on details", async () => {
    const fake = scripted();
    fakeTransactions(sql, fake.pool);

    for (const details of ["{nope", "x".repeat(12001)])
      await assert.rejects(submit(fake.pool, { details }), (error) => {
        assert.deepEqual(Object.keys(error.errors), ["details"]);
        return true;
      });
  });

  // The date of birth is the enrollment's, read by the server; the person cannot move it.
  test("the date of birth rule uses the enrollment's", async () => {
    const fake = scripted();
    fakeTransactions(sql, fake.pool);
    const early = { ...DEATH_DETAILS, event: { date: "1991-03-13" } };

    await assert.rejects(submit(fake.pool, { details: json(early) }), (error) => {
      assert.deepEqual(Object.keys(error.errors), ["event.date"]);
      return true;
    });
  });

  test("a type with no details form takes none, and keeps none", async () => {
    const fake = scripted();
    fakeTransactions(sql, fake.pool);

    await assert.rejects(
      submit(fake.pool, { claimTypeId: "1", documents: [doc("requirement_1")], details: json(DEATH_DETAILS) }),
      (error) => {
        assert.deepEqual(Object.keys(error.errors), ["details"]);
        return true;
      },
    );

    const { claimId } = await submit(fake.pool, { claimTypeId: "1", documents: [doc("requirement_1")], details: undefined });

    assert.equal(claimId, "30");
    assert.equal(getDetails("30"), null);
    // No enrollment to read for a claim with nothing to work out.
    assert.equal(callTo(fake.calls, ENROLLMENT), undefined);
  });

  test("an employee with no enrollment row is 404, before anything is written", async () => {
    const fake = scripted({ enrollment: null });
    const log = fakeTransactions(sql, fake.pool);

    await assert.rejects(submit(fake.pool), refusedWith(404, /^Enrollment not found$/));
    assert.equal(log.begun, 0);
  });

  test("the refusals that came before still come first", async () => {
    const fake = scripted();
    fakeTransactions(sql, fake.pool);

    await assert.rejects(submit(fake.pool, { claimTypeId: "99" }), refusedWith(400, /^This claim type cannot be filed here$/));
    await assert.rejects(submit(fake.pool, { documents: [] }), refusedWith(400, /^Missing required documents: Death certificate$/));
    assert.equal(callTo(fake.calls, ENROLLMENT), undefined);
  });

  // The claim does not exist until the commit, so neither can its details.
  test("nothing is kept when the transaction does not commit", async () => {
    const fake = scripted();
    const log = fakeTransactions(sql, fake.pool, { failCommit: true });

    await assert.rejects(submit(fake.pool), /commit failed/);

    assert.equal(log.rolledBack, 1);
    assert.equal(getDetails("30"), null);
    assert.equal(fs.existsSync(store.file), false);
  });
});

describe("HR filing with the details switch on", () => {
  useClaimStore();

  const forEmployee = (pool, overrides = {}) =>
    ClaimService.fileClaimForEmployee(pool, {
      userId: 3,
      roleName: "HR",
      clientId: "75",
      claimTypeId: "11",
      documents: [doc("requirement_92")],
      details: json(TPD_DETAILS),
      ...overrides,
    });

  const deathClaim = (pool, overrides = {}) =>
    ClaimService.fileDeathClaim(pool, {
      userId: 3,
      roleName: "HR",
      clientId: "75",
      claimTypeId: "20",
      documents: [doc("requirement_95")],
      details: json(DEATH_DETAILS),
      ...overrides,
    });

  test("a claim for an employee keeps its details, reading the enrollment once, and queues nothing", async () => {
    const fake = scripted();
    fakeTransactions(sql, fake.pool);

    const { claimId } = await forEmployee(fake.pool);

    assert.equal(claimId, "30");
    assert.equal(getDetails("30").claimant.relationship, "SELF");
    assert.equal(getDetails("30").insured.client_id, "75");
    assert.equal(fake.calls.filter((call) => call.procedure === ENROLLMENT).length, 1);
    assert.equal(getTransfer("30"), null);
  });

  test("the same rules, and a 400 before anything is written", async () => {
    const fake = scripted();
    const log = fakeTransactions(sql, fake.pool);

    await assert.rejects(forEmployee(fake.pool, { details: undefined }), (error) => {
      assert.deepEqual(Object.keys(error.errors), ["details"]);
      return true;
    });
    assert.equal(log.begun, 0);
  });

  test("a death claim keeps its details and is queued for the claims web app as HR's, approved on filing", async () => {
    const fake = scripted({ enrollment: { ...ENROLLMENT_ROW, date_of_death: "2026-03-01" } });
    fakeTransactions(sql, fake.pool);

    const { claimId } = await deathClaim(fake.pool);

    assert.equal(claimId, "30");
    assert.equal(getDetails("30").condition.manner_of_death, "NATURAL");

    const transfer = getTransfer("30");
    assert.equal(transfer.status, "QUEUED");
    assert.equal(transfer.reader_user_id, "3", "the claim is read as the person who filed it");
    assert.equal(transfer.claim_type_code, "DEATH");
  });

  test("a death claim whose details are refused is not filed and not queued", async () => {
    const fake = scripted({ enrollment: { ...ENROLLMENT_ROW, date_of_death: "2026-03-01" } });
    const log = fakeTransactions(sql, fake.pool);

    await assert.rejects(deathClaim(fake.pool, { details: json({ ...DEATH_DETAILS, claimant: { ...DEATH_DETAILS.claimant, relationship: "SELF" } }) }), (error) => {
      assert.deepEqual(Object.keys(error.errors), ["claimant.relationship"]);
      return true;
    });

    assert.equal(log.begun, 0);
    assert.equal(getTransfer("30"), null);
  });

  test("a death claim that does not commit is not queued", async () => {
    const fake = scripted({ enrollment: { ...ENROLLMENT_ROW, date_of_death: "2026-03-01" } });
    fakeTransactions(sql, fake.pool, { failCommit: true });

    await assert.rejects(deathClaim(fake.pool), /commit failed/);

    assert.equal(getTransfer("30"), null);
    assert.equal(getDetails("30"), null);
  });
});

describe("resubmitting with the details switch on", () => {
  useClaimStore();

  const RETURNED = { ...HEADER, claim_status: "RETURNED" };

  const resubmit = (pool, overrides = {}) =>
    ClaimService.resubmitClaim(pool, {
      userId: 12,
      claimId: "30",
      documents: [doc("requirement_92")],
      details: json(TPD_DETAILS),
      ...overrides,
    });

  test("the new details replace the ones kept, and the claim keeps the day it was filed", async () => {
    const fake = scripted({ header: RETURNED });
    fakeTransactions(sql, fake.pool);

    await resubmit(fake.pool);
    assert.equal(getDetails("30").event.date, "2026-03-10");
    // Filed 20 May 2026, whatever day it is resubmitted.
    assert.equal(getDetails("30").computed.filed_month, "May");

    const changed = { ...TPD_DETAILS, event: { date: "2026-03-11" } };
    await resubmit(fake.pool, { details: json(changed) });
    assert.equal(getDetails("30").event.date, "2026-03-11");
  });

  test("details that break a rule are 400 and the transaction never opens", async () => {
    const fake = scripted({ header: RETURNED });
    const log = fakeTransactions(sql, fake.pool);

    await assert.rejects(resubmit(fake.pool, { details: undefined }), (error) => {
      assert.deepEqual(Object.keys(error.errors), ["details"]);
      return true;
    });
    assert.equal(log.begun, 0);
    assert.equal(callTo(fake.calls, "bes.usp_upd_claim_resubmit"), undefined);
  });
});

describe("approving a claim with the details switch on", () => {
  useClaimStore();

  const review = (pool, status, overrides = {}) =>
    ClaimService.reviewClaim(pool, {
      userId: 3,
      claimId: "30",
      status,
      remarks: status === "APPROVED" ? null : "Add the medical certificate",
      ...overrides,
    });

  test("queues it for the claims web app, to be read as the person who approved it", async () => {
    const fake = scripted();

    await review(fake.pool, "APPROVED");

    const transfer = getTransfer("30");
    assert.equal(transfer.status, "QUEUED");
    assert.equal(transfer.reader_user_id, "3");
    assert.equal(transfer.claim_type_code, "TPD");
  });

  test("a claim that is returned or rejected is not queued", async () => {
    for (const status of ["RETURNED", "REJECTED"]) {
      const fake = scripted();

      await review(fake.pool, status);

      assert.equal(getTransfer("30"), null, status);
    }
  });

  test("a decision the database refuses queues nothing", async () => {
    const failing = fakePool({
      [DETAIL]: () => ({ recordsets: [[HEADER], [], []], recordset: [HEADER] }),
      [REVIEW]: () => {
        throw Object.assign(new Error("not pending"), { number: 50153 });
      },
    });

    await assert.rejects(review(failing.pool, "APPROVED"));

    assert.equal(getTransfer("30"), null);
  });
});

describe("with the details switch off the service is what it was", () => {
  const store = useClaimStore({ on: false });

  test("details sent are ignored: no enrollment read, nothing kept, no file made", async () => {
    const fake = scripted();
    const log = fakeTransactions(sql, fake.pool);

    const { claimId } = await submit(fake.pool);

    assert.equal(claimId, "30");
    assert.equal(log.committed, 1);
    assert.equal(callTo(fake.calls, ENROLLMENT), undefined);
    assert.equal(callTo(fake.calls, BENEFITS), undefined);
    assert.equal(fs.existsSync(store.file), false);
  });

  test("details that would be refused are not looked at", async () => {
    const fake = scripted();
    fakeTransactions(sql, fake.pool);

    for (const details of ["{nope", json({ nonsense: true }), undefined])
      assert.equal((await submit(fake.pool, { details })).claimId, "30");
  });

  test("a death claim is not queued, and a returned claim resubmits without details", async () => {
    const fake = scripted({ enrollment: { ...ENROLLMENT_ROW, date_of_death: "2026-03-01" } });
    fakeTransactions(sql, fake.pool);

    await ClaimService.fileDeathClaim(fake.pool, {
      userId: 3,
      roleName: "HR",
      clientId: "75",
      claimTypeId: "20",
      documents: [doc("requirement_95")],
    });

    const returned = scripted({ header: { ...HEADER, claim_status: "RETURNED" } });
    fakeTransactions(sql, returned.pool);
    await ClaimService.resubmitClaim(returned.pool, { userId: 12, claimId: "30", documents: [doc("requirement_92")] });

    assert.equal(fs.existsSync(store.file), false);
  });

  test("approving a claim queues nothing", async () => {
    const fake = scripted();

    await ClaimService.reviewClaim(fake.pool, { userId: 3, claimId: "30", status: "APPROVED", remarks: null });

    assert.equal(fs.existsSync(store.file), false);
  });
});
