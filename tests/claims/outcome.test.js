import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";
import { useClaimStore } from "../helpers/claimStore.js";

const { AMOUNT_FIELDS, checkOutcome, outcomeView } = await import("../../src/claims/outcome.js");
const { getOutcome, saveOutcome } = await import("../../src/claims/detailsStore.js");

const FULL = {
  status: "Paid-Partial",
  status_updated: "2026-11-20",
  total_claim_amount: 50000,
  burial_benefit_amount: 10000.5,
  credit_claim_benefit_amount: 0,
  amount_paid: 35000,
  denial_letter_date: "2026-11-18",
  denial_reason: "ADB denied: death not accidental",
  awaiting_reason: "Waiting for the loan statement",
};

const keysOf = (errors) => Object.keys(errors).sort();

describe("checkOutcome", () => {
  test("a full report comes back as it was sent", () => {
    const { value, errors } = checkOutcome(FULL);

    assert.deepEqual({ ...errors }, {});
    assert.deepEqual(value, FULL);
  });

  test("one field is enough, and text is trimmed", () => {
    assert.deepEqual(checkOutcome({ status: "  For Payment " }).value, { status: "For Payment" });
    assert.deepEqual(checkOutcome({ amount_paid: 1234.56 }).value, { amount_paid: 1234.56 });
  });

  test("null and an empty text mean not given", () => {
    const { value } = checkOutcome({ status: "Paid", denial_reason: "", awaiting_reason: null, amount_paid: null });

    assert.deepEqual(value, { status: "Paid" });
  });

  test("nothing at all, or only what is not given, is refused", () => {
    for (const body of [{}, { status: "" }, { status: null, amount_paid: null }]) {
      const { value, errors } = checkOutcome(body);

      assert.equal(value, null);
      assert.deepEqual(keysOf(errors), ["outcome"]);
    }
  });

  test("anything but an object is refused", () => {
    for (const body of [undefined, null, "Paid", 5, ["Paid"]]) assert.deepEqual(keysOf(checkOutcome(body).errors), ["outcome"], String(body));
  });

  test("a key that is not part of it is refused, __proto__ and constructor among them", () => {
    const { errors } = checkOutcome(JSON.parse('{ "status": "Paid", "fax": 1, "__proto__": { "x": 1 }, "constructor": 2 }'));

    assert.deepEqual(keysOf(errors), ["__proto__", "constructor", "fax"]);
  });

  test("an amount is a number from 0 with at most two decimals", () => {
    for (const bad of [-1, 1.005, 1e12, "50000", NaN, Infinity, true, {}, []])
      assert.deepEqual(keysOf(checkOutcome({ amount_paid: bad }).errors), ["amount_paid"], String(bad));

    for (const good of [0, 0.01, 50000, 999999999.99]) assert.equal(checkOutcome({ amount_paid: good }).value.amount_paid, good);
  });

  test("a date is a real day written YYYY-MM-DD", () => {
    for (const bad of ["2026-02-30", "11/20/2026", "2026-13-01", "tomorrow", 20261120, {}])
      assert.deepEqual(keysOf(checkOutcome({ status_updated: bad }).errors), ["status_updated"], String(bad));
  });

  test("text has its limits: 100 for the status, 300 for a reason", () => {
    assert.equal(checkOutcome({ status: "x".repeat(100) }).value.status.length, 100);
    assert.deepEqual(keysOf(checkOutcome({ status: "x".repeat(101) }).errors), ["status"]);
    assert.equal(checkOutcome({ denial_reason: "x".repeat(300) }).value.denial_reason.length, 300);
    assert.deepEqual(keysOf(checkOutcome({ denial_reason: "x".repeat(301) }).errors), ["denial_reason"]);
    assert.deepEqual(keysOf(checkOutcome({ awaiting_reason: 5 }).errors), ["awaiting_reason"]);
  });

  test("every problem is named, and the first is the message", () => {
    const { value, errors } = checkOutcome({ status: 7, amount_paid: -5, status_updated: "x" });

    assert.equal(value, null);
    assert.deepEqual(keysOf(errors), ["amount_paid", "status", "status_updated"]);
  });
});

describe("outcomeView", () => {
  const stored = { ...FULL, reported_at: "2026-11-20T01:00:00.000Z" };

  test("HR sees all of it", () => {
    assert.deepEqual(outcomeView(stored, { amounts: true }), stored);
  });

  test("the employee sees what was said about the claim and not what it pays", () => {
    const view = outcomeView(stored, { amounts: false });

    for (const key of AMOUNT_FIELDS) assert.equal(key in view, false, key);
    assert.deepEqual(Object.keys(view).sort(), ["awaiting_reason", "denial_letter_date", "denial_reason", "reported_at", "status", "status_updated"]);
    assert.equal("amount_paid" in stored, true, "what is stored is not changed");
  });

  test("is null when nothing has been reported", () => {
    assert.equal(outcomeView(null, { amounts: true }), null);
    assert.equal(outcomeView(null, { amounts: false }), null);
  });

  test("the amounts are the four the claims department works out and pays", () => {
    assert.deepEqual(AMOUNT_FIELDS, ["total_claim_amount", "burial_benefit_amount", "credit_claim_benefit_amount", "amount_paid"]);
  });
});

describe("the stored outcome", () => {
  useClaimStore();

  test("is null before anything is reported", () => {
    assert.equal(getOutcome("30"), null);
  });

  test("is kept with the time it was reported, and a new report replaces it", () => {
    saveOutcome("30", { status: "For Payment", total_claim_amount: 50000 });
    assert.equal(getOutcome("30").status, "For Payment");
    assert.match(getOutcome("30").reported_at, /^\d{4}-\d{2}-\d{2}T/);

    saveOutcome("30", { status: "Paid", amount_paid: 50000 });

    const kept = getOutcome("30");
    assert.equal(kept.status, "Paid");
    assert.equal(kept.amount_paid, 50000);
    assert.equal("total_claim_amount" in kept, false, "what the new report does not carry is not kept");
  });

  test("one claim's outcome is not another's", () => {
    saveOutcome("30", { status: "Paid" });

    assert.equal(getOutcome("31"), null);
  });
});
