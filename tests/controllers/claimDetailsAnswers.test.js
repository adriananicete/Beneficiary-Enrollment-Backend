import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";
import { useClaimStore } from "../helpers/claimStore.js";

const { claimTypeOf, hrClaimTypesOf, withDetails } = await import("../../src/controllers/claimController.js");
const { saveDetails } = await import("../../src/claims/detailsStore.js");

// What the claim answers gain: `profile` on every claim type, whatever the switch, and `details` on
// a claim's detail while the switch is on.

const type = (code) => ({ claim_type_id: "1", claim_type_code: code, claim_type_desc: code, ends_coverage: false });

const PROFILES = [
  ["DEATH", "death"],
  ["TPD", "tpd"],
  ["TERMINAL_ILLNESS", "terminal_illness"],
  ["DISMEMBERMENT", "dismemberment"],
  ["TEST-CLAIM", "general"],
  ["TEST-DEATH", "general"],
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
    });
  });

  describe("with the switch on", () => {
    useClaimStore();

    test("carries the claim's details, as the contract's object", () => {
      saveDetails("30", DETAILS);

      const shown = withDetails(answer(), "30");

      assert.deepEqual(Object.keys(shown), ["claim", "documents", "requirements", "details"]);
      assert.deepEqual(Object.keys(shown.details), ["claimant", "event", "condition", "insured", "computed", "coverage"]);
      assert.equal(shown.details.claimant.name, "Carlos Santos");
    });

    test("is null for a claim that has none", () => {
      assert.equal(withDetails(answer(), "30").details, null);
    });

    test("does not touch the answer it was given", () => {
      const data = answer();

      withDetails(data, "30");

      assert.equal("details" in data, false);
    });
  });
});
