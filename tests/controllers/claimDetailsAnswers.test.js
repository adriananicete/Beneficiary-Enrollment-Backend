import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";
import { useClaimStore } from "../helpers/claimStore.js";

const { claimTypeOf, hrClaimTypesOf, withDetails } = await import("../../src/controllers/claimController.js");
const { saveDetails, saveOutcome } = await import("../../src/claims/detailsStore.js");

// What the claim answers gain: `profile` on every claim type, whatever the switch, and `details` on
// a claim's detail while the switch is on.

const type = (code) => ({ claim_type_id: "1", claim_type_code: code, claim_type_desc: code, ends_coverage: false });

const PROFILES = [
  ["DEATH", "death"],
  ["TPD", "tpd"],
  ["TERMINAL_ILLNESS", "terminal_illness"],
  ["DISMEMBERMENT", "dismemberment"],
  ["NO-DOCS", "general"],
  ["OTHER", "general"],
];

describe("every claim type carries its profile", () => {
  for (const on of [false, true]) {
    describe(`with the details switch ${on ? "on" : "off"}`, () => {
      useClaimStore({ on });

      for (const [code, profile] of PROFILES)
        test(`${code} is ${profile}`, () => {
          assert.equal(claimTypeOf(type(code), []).profile, profile);
        });
    });
  }

  test("the rest of the type is as it was", () => {
    assert.deepEqual(Object.keys(claimTypeOf(type("DEATH"), [])), [
      "claim_type_id",
      "claim_type_code",
      "claim_type_desc",
      "ends_coverage",
      "profile",
      "requirements",
    ]);
  });

  test("HR's list has it on its own types and on the employee's", () => {
    const own = { types: [type("DEATH")], requirements: [] };
    const general = { types: [type("TPD"), type("TEST-CLAIM")], requirements: [] };

    assert.deepEqual(
      hrClaimTypesOf(own, general).map((listed) => [listed.claim_type_code, listed.profile, listed.filed_by]),
      [
        ["DEATH", "death", "HR"],
        ["TPD", "tpd", "EMPLOYEE"],
        ["TEST-CLAIM", "general", "EMPLOYEE"],
      ],
    );
  });
});

const DETAILS = {
  details: {
    claimant: { name: "Carlos Santos" },
    event: { date: "2026-10-02" },
    condition: { immediate_cause: "Myocardial infarction" },
  },
  insured: { client_id: "501" },
  computed: { age_at_event: 35 },
  coverage: [],
};

describe("withDetails: the claim's detail answer", () => {
  const answer = () => ({ claim: { claim_id: "30" }, documents: [], requirements: [] });

  describe("with the switch off", () => {
    useClaimStore({ on: false });

    test("is the answer it always was, with no details key at all", () => {
      const data = answer();
      saveDetails("30", DETAILS);

      const shown = withDetails(data, "30");

      assert.equal(shown, data);
      assert.equal("details" in shown, false);
      assert.equal("outcome" in shown, false);
    });
  });

  describe("with the switch on", () => {
    useClaimStore();

    test("carries the claim's details, as the contract's object", () => {
      saveDetails("30", DETAILS);

      const shown = withDetails(answer(), "30");

      assert.deepEqual(Object.keys(shown), ["claim", "documents", "requirements", "details", "outcome"]);
      assert.deepEqual(Object.keys(shown.details), ["claimant", "event", "condition", "insured", "computed", "coverage"]);
      assert.equal(shown.details.claimant.name, "Carlos Santos");
    });

    test("is null for a claim that has none", () => {
      assert.equal(withDetails(answer(), "30").details, null);
    });

    test("carries what the claims web app reported: all of it for HR, without the amounts for the employee", () => {
      saveOutcome("30", { status: "Paid-Partial", amount_paid: 35000, total_claim_amount: 50000, denial_reason: "ADB denied" });

      const forHr = withDetails(answer(), "30", { amounts: true }).outcome;
      assert.equal(forHr.status, "Paid-Partial");
      assert.equal(forHr.amount_paid, 35000);
      assert.equal(forHr.total_claim_amount, 50000);

      for (const forEmployee of [withDetails(answer(), "30").outcome, withDetails(answer(), "30", { amounts: false }).outcome]) {
        assert.equal(forEmployee.status, "Paid-Partial");
        assert.equal(forEmployee.denial_reason, "ADB denied");
        assert.equal("amount_paid" in forEmployee, false);
        assert.equal("total_claim_amount" in forEmployee, false);
      }
    });

    test("HR's answer, given the claim, also says what the policy pays for it; the employee's never does", () => {
      saveDetails("30", {
        ...DETAILS,
        details: { ...DETAILS.details, condition: { manner_of_death: "ACCIDENT", immediate_cause: "Crash" } },
        insured: { company_code: null },
        computed: { age_at_event: 35, contestability: "INCONTESTABLE", event_before_coverage: false },
        coverage: [
          { code: "GTLIP", description: "Life", amount: 500000, formula: null },
          { code: "GADDR", description: "Accidental", amount: 500000, formula: null },
        ],
      });
      const claim = { claim_type_code: "DEATH", filed_date: "2026-10-12" };

      const forHr = withDetails(answer(), "30", { amounts: true, claim });
      assert.equal(forHr.policy.total, 1000000);
      assert.deepEqual(forHr.policy.lines.map((entry) => entry.key), ["life", "accidental"]);

      assert.equal("policy" in withDetails(answer(), "30", { claim }), false, "not without amounts");
      assert.equal("policy" in withDetails(answer(), "30", { amounts: true }), false, "not without the claim to read it against");
      assert.equal("policy" in withDetails(answer(), "31", { amounts: true, claim }), false, "not for a claim with no details");
    });

    test("has no outcome until the claims web app reports one", () => {
      assert.equal(withDetails(answer(), "30", { amounts: true }).outcome, null);
    });

    test("does not touch the answer it was given", () => {
      const data = answer();

      withDetails(data, "30");

      assert.equal("details" in data, false);
    });
  });
});
