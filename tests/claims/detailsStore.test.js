import { afterEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import "../helpers/env.js";
import { useClaimStore } from "../helpers/claimStore.js";
import { forgetStore, update } from "../../src/gcli/devStore.js";
import { AppError } from "../../src/utils/AppError.js";

const {
  assertClaimDetailsAllowed,
  claimDetailsOn,
  enqueueTransfer,
  getDetails,
  getTransfer,
  listTransfers,
  recordTransfer,
  saveDetails,
} = await import("../../src/claims/detailsStore.js");

const withEnv = (changes, run) => {
  const saved = Object.fromEntries(Object.keys(changes).map((name) => [name, process.env[name]]));
  for (const [name, value] of Object.entries(changes)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    return run();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
};

describe("the switch", () => {
  test("is off unless CLAIM_DETAILS_DEV_STORE is exactly true", () => {
    for (const value of [undefined, "", "false", "1", "TRUE", "yes"])
      assert.equal(withEnv({ CLAIM_DETAILS_DEV_STORE: value, NODE_ENV: "development" }, claimDetailsOn), false, String(value));
    assert.equal(withEnv({ CLAIM_DETAILS_DEV_STORE: "true", NODE_ENV: "development" }, claimDetailsOn), true);
  });

  test("is never on in production, and the server refuses to start with it set there", () => {
    assert.equal(withEnv({ CLAIM_DETAILS_DEV_STORE: "true", NODE_ENV: "production" }, claimDetailsOn), false);
    assert.throws(
      () => withEnv({ CLAIM_DETAILS_DEV_STORE: "true", NODE_ENV: "production" }, assertClaimDetailsAllowed),
      /development only/,
    );
    assert.doesNotThrow(() => withEnv({ CLAIM_DETAILS_DEV_STORE: "true", NODE_ENV: "development" }, assertClaimDetailsAllowed));
    assert.doesNotThrow(() => withEnv({ CLAIM_DETAILS_DEV_STORE: undefined, NODE_ENV: "production" }, assertClaimDetailsAllowed));
  });

  // The two switches are separate: one must not turn the other on.
  test("is not the Group Credit Life switch", () => {
    assert.equal(withEnv({ CLAIM_DETAILS_DEV_STORE: undefined, GCLI_DEV_STORE: "true", NODE_ENV: "development" }, claimDetailsOn), false);
  });
});

const DETAILS = {
  details: {
    claimant: { name: "Carlos Santos", relationship: "SPOUSE", contact_no: "09171234567" },
    event: { date: "2026-10-02" },
    condition: { immediate_cause: "Myocardial infarction", manner_of_death: "NATURAL" },
  },
  insured: { client_id: "501", full_name: "Maria Reyes Santos" },
  computed: { age_at_event: 35 },
  coverage: [{ code: "GTLIP", amount: 500000 }],
};

describe("the details", () => {
  const store = useClaimStore();

  test("are kept under claimDetails in the shared file, and read back as the contract's object", () => {
    saveDetails("30", DETAILS);

    assert.deepEqual(getDetails("30"), {
      claimant: DETAILS.details.claimant,
      event: DETAILS.details.event,
      condition: DETAILS.details.condition,
      insured: DETAILS.insured,
      computed: DETAILS.computed,
      coverage: DETAILS.coverage,
    });

    const onDisk = JSON.parse(fs.readFileSync(store.file, "utf8"));
    assert.deepEqual(Object.keys(onDisk.claimDetails), ["30"]);
    assert.match(onDisk.claimDetails["30"].saved_at, /^\d{4}-\d{2}-\d{2}T/);
  });

  test("are read back after a restart", () => {
    saveDetails("30", DETAILS);
    forgetStore();

    assert.equal(getDetails("30").claimant.name, "Carlos Santos");
  });

  test("a claim without any answers null, and so does an empty store", () => {
    assert.equal(getDetails("30"), null);

    saveDetails("31", DETAILS);
    assert.equal(getDetails("30"), null);
  });

  test("the id may be a number or text", () => {
    saveDetails(30, DETAILS);

    assert.ok(getDetails("30"));
    assert.ok(getDetails(30));
  });

  test("saving again replaces them: a resubmit has new details", () => {
    saveDetails("30", DETAILS);
    saveDetails("30", { ...DETAILS, details: { ...DETAILS.details, event: { date: "2026-10-03" } } });

    assert.equal(getDetails("30").event.date, "2026-10-03");
  });

  // The file is Group Credit Life's first. Writing a claim must not lose a loan application.
  test("leave what else the file holds alone", () => {
    update((draft) => {
      draft.lastApplication = 7;
      draft.companies["2"] = { plan_code: "GCLIP" };
    });

    saveDetails("30", DETAILS);
    enqueueTransfer("30", { readerUserId: "5", claimTypeCode: "DEATH" });
    forgetStore();

    const onDisk = JSON.parse(fs.readFileSync(store.file, "utf8"));
    assert.equal(onDisk.lastApplication, 7);
    assert.deepEqual(onDisk.companies, { 2: { plan_code: "GCLIP" } });
  });

  test("a file written before these keys existed is read and extended", () => {
    fs.writeFileSync(store.file, JSON.stringify({ lastApplication: 3, companies: {}, applications: [], invitedEmployeeIds: {} }));
    forgetStore();

    assert.equal(getDetails("30"), null);
    assert.equal(getTransfer("30"), null);
    assert.deepEqual(listTransfers("ALL", 10), { items: [], next_after: null });

    saveDetails("30", DETAILS);
    assert.ok(getDetails("30"));
  });
});

describe("queueing a transfer", () => {
  useClaimStore();

  test("a claim is queued with who approved it, so the claim can be read as that person", () => {
    enqueueTransfer("30", { readerUserId: 5, claimTypeCode: "DEATH" });

    const transfer = getTransfer("30");

    assert.equal(transfer.claim_id, "30");
    assert.equal(transfer.status, "QUEUED");
    assert.equal(transfer.attempts, 0);
    assert.equal(transfer.reference, null);
    assert.equal(transfer.last_error, null);
    assert.equal(transfer.last_attempt_at, null);
    assert.equal(transfer.reader_user_id, "5");
    assert.equal(transfer.claim_type_code, "DEATH");
    assert.match(transfer.queued_at, /^\d{4}-\d{2}-\d{2}T/);
  });

  test("queuing again changes nothing", () => {
    enqueueTransfer("30", { readerUserId: "5", claimTypeCode: "DEATH" });
    const first = getTransfer("30");

    enqueueTransfer("30", { readerUserId: "9", claimTypeCode: "TPD" });

    assert.deepEqual(getTransfer("30"), first);
  });

  test("a claim that was never queued is null", () => {
    assert.equal(getTransfer("30"), null);
  });
});

describe("listing the transfers", () => {
  useClaimStore();

  const queue = (...ids) => ids.forEach((id) => enqueueTransfer(id, { readerUserId: "5", claimTypeCode: "TPD" }));

  test("QUEUED is the claims waiting, and ALL is every one", () => {
    queue("1", "2", "3");
    recordTransfer("2", "SENT", "REF-2");
    recordTransfer("3", "FAILED", undefined, "Policy not found");

    assert.deepEqual(listTransfers("QUEUED", 50).items.map((item) => item.claim_id), ["1"]);
    assert.deepEqual(listTransfers("SENT", 50).items.map((item) => item.claim_id), ["2"]);
    assert.deepEqual(listTransfers("FAILED", 50).items.map((item) => item.claim_id), ["3"]);
    assert.deepEqual(listTransfers("ALL", 50).items.map((item) => item.claim_id), ["1", "2", "3"]);
  });

  // Ids are text in the store; "9" sorts after "10" as text.
  test("are in the order the claims were made, which for ids is numeric", () => {
    queue("10", "9", "100");

    assert.deepEqual(listTransfers("ALL", 50).items.map((item) => item.claim_id), ["9", "10", "100"]);
  });

  test("a page ends with the id to continue after, and the last page with null", () => {
    queue("1", "2", "3", "4", "5");

    const first = listTransfers("QUEUED", 2);
    assert.deepEqual(first.items.map((item) => item.claim_id), ["1", "2"]);
    assert.equal(first.next_after, "2");

    const second = listTransfers("QUEUED", 2, first.next_after);
    assert.deepEqual(second.items.map((item) => item.claim_id), ["3", "4"]);
    assert.equal(second.next_after, "4");

    const third = listTransfers("QUEUED", 2, second.next_after);
    assert.deepEqual(third.items.map((item) => item.claim_id), ["5"]);
    assert.equal(third.next_after, null);
  });

  test("a page that is exactly full has no next page", () => {
    queue("1", "2");

    assert.equal(listTransfers("QUEUED", 2).next_after, null);
  });

  test("an empty list is an empty page", () => {
    assert.deepEqual(listTransfers("QUEUED", 50), { items: [], next_after: null });
  });
});

describe("recording what the claims web app reports", () => {
  useClaimStore();

  const refused = (status, message) => (error) =>
    error instanceof AppError && error.statusCode === status && message.test(error.message);

  const queued = () => enqueueTransfer("30", { readerUserId: "5", claimTypeCode: "DEATH" });

  test("SENT keeps its reference, counts an attempt and clears any earlier error", () => {
    queued();
    recordTransfer("30", "FAILED", undefined, "Policy not found");

    const transfer = recordTransfer("30", "SENT", "ARDCI-2026-0412");

    assert.equal(transfer.status, "SENT");
    assert.equal(transfer.reference, "ARDCI-2026-0412");
    assert.equal(transfer.attempts, 2);
    assert.equal(transfer.last_error, null);
    assert.match(transfer.last_attempt_at, /^\d{4}-/);
    assert.deepEqual(getTransfer("30"), transfer);
  });

  test("FAILED keeps the reason and can be tried again", () => {
    queued();

    const first = recordTransfer("30", "FAILED", undefined, "Policy not found");
    assert.equal(first.status, "FAILED");
    assert.equal(first.last_error, "Policy not found");
    assert.equal(first.reference, null);
    assert.equal(first.attempts, 1);

    const second = recordTransfer("30", "FAILED", undefined, "Timed out");
    assert.equal(second.last_error, "Timed out");
    assert.equal(second.attempts, 2);
  });

  test("the same SENT again is accepted and changes nothing, not even the attempts", () => {
    queued();
    const sent = recordTransfer("30", "SENT", "ARDCI-2026-0412");

    const again = recordTransfer("30", "SENT", "ARDCI-2026-0412");

    assert.deepEqual(again, sent);
    assert.equal(getTransfer("30").attempts, 1);
    assert.equal(getTransfer("30").last_attempt_at, sent.last_attempt_at);
  });

  test("a different reference for a claim already SENT is 409, and the first stays", () => {
    queued();
    recordTransfer("30", "SENT", "ARDCI-2026-0412");

    assert.throws(() => recordTransfer("30", "SENT", "ARDCI-2026-9999"), refused(409, /another reference/));

    assert.equal(getTransfer("30").reference, "ARDCI-2026-0412");
    assert.equal(getTransfer("30").attempts, 1);
  });

  test("a SENT claim cannot go back to FAILED", () => {
    queued();
    recordTransfer("30", "SENT", "ARDCI-2026-0412");

    assert.throws(() => recordTransfer("30", "FAILED", undefined, "Late failure"), refused(409, /cannot be marked as failed/));

    assert.equal(getTransfer("30").status, "SENT");
    assert.equal(getTransfer("30").last_error, null);
  });

  test("a claim that was never queued is 404", () => {
    assert.throws(() => recordTransfer("30", "SENT", "REF"), refused(404, /not found/));
  });

  test("a refused report writes nothing", () => {
    queued();
    recordTransfer("30", "SENT", "ARDCI-2026-0412");
    const before = fs.readFileSync(process.env.GCLI_DEV_STORE_FILE, "utf8");

    assert.throws(() => recordTransfer("30", "SENT", "OTHER"));

    assert.equal(fs.readFileSync(process.env.GCLI_DEV_STORE_FILE, "utf8"), before);
  });
});

// Windows answers EPERM or EBUSY for a moment when a scanner has the store file open as it is replaced.
// Seen as a 500 on a report to the hand-off API, and reproduced by opening the file in a loop.
describe("writing while the file is locked", () => {
  useClaimStore();

  afterEach(() => mock.restoreAll());

  // Refuses the rename `times` times, with `code`, and then lets it through.
  const lock = (code, times) => {
    const original = fs.renameSync;
    let refused = 0;

    return mock.method(fs, "renameSync", (...args) => {
      if (refused++ < times) throw Object.assign(new Error(`${code}: operation not permitted, rename`), { code });

      return original(...args);
    });
  };

  test("a rename refused for a moment is tried again, and the change is kept", () => {
    const rename = lock("EPERM", 2);

    saveDetails("30", DETAILS);

    assert.equal(rename.mock.callCount(), 3);
    assert.equal(getDetails("30").claimant.name, "Carlos Santos");
  });

  test("EBUSY and EACCES are the same", () => {
    for (const code of ["EBUSY", "EACCES"]) {
      const rename = lock(code, 1);

      saveDetails(code, DETAILS);

      assert.equal(rename.mock.callCount(), 2, code);
      mock.restoreAll();
    }
  });

  test("gives up after five tries and throws the last error, keeping nothing", () => {
    const rename = lock("EPERM", 99);

    assert.throws(() => saveDetails("30", DETAILS), (error) => error.code === "EPERM");
    assert.equal(rename.mock.callCount(), 5);

    mock.restoreAll();
    forgetStore();
    assert.equal(getDetails("30"), null);
  });

  test("any other error is thrown at once", () => {
    const rename = lock("ENOSPC", 99);

    assert.throws(() => saveDetails("30", DETAILS), (error) => error.code === "ENOSPC");
    assert.equal(rename.mock.callCount(), 1);
  });

  test("a queued transfer and a report are covered too", () => {
    lock("EPERM", 1);
    enqueueTransfer("30", { readerUserId: "5", claimTypeCode: "DEATH" });
    mock.restoreAll();

    lock("EPERM", 1);
    recordTransfer("30", "SENT", "ARDCI-1");
    mock.restoreAll();

    assert.equal(getTransfer("30").status, "SENT");
  });
});
