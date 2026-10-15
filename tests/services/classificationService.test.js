import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";
import { fakePool, inputsFor } from "../helpers/fakePool.js";

const { default: ClassificationService, classificationOf } = await import(
  "../../src/services/classificationService.js"
);

// Classifications belong to a company since DBA request 23, read back
// 2026-10-15. Coforge (1) keeps classes 1–10; HCL (2) has its own copies,
// 11–20, with the same codes. Both lists here are one company's and nothing
// else, and neither may carry an amount.

const TOKEN = "usp_sel_enrollment_invitation_by_token";
const CLASSES = "usp_sel_classifications_by_employer";
const EMPLOYERS_BY_USER = "sec.us08_usp_sel_employers_by_user";

const LINK = "a".repeat(64);

const invitation = (overrides = {}) => ({
  invitation_id: "54",
  employer_id: "1",
  is_valid: 1,
  is_enrolled: 0,
  ...overrides,
});

// Coforge's and HCL's VP, as the procedure returns them, with an amount the
// procedure does not return today, to prove it would not leave if it did.
const byCompany = ({ employer_id }) => ({
  recordset:
    String(employer_id) === "1"
      ? [{ classification_id: "1", classification_code: "VP", classification_desc: "Vice President", coverage_amount: 3000000 }]
      : [{ classification_id: "11", classification_code: "VP", classification_desc: "Vice President", coverage_amount: 3000000 }],
  output: {},
});

describe("classificationOf — what a classification may show", () => {
  // Pinned as a literal: adding a field here is a change to what the public
  // form and HR receive.
  test("answers with the id, the code and the name", () => {
    const shown = classificationOf({
      classification_id: "1",
      classification_code: "VP",
      classification_desc: "Vice President",
    });

    assert.deepEqual(Object.keys(shown).sort(), [
      "classification_code",
      "classification_desc",
      "classification_id",
    ]);
  });

  test("leaves out anything else the row carries, amounts first of all", () => {
    const shown = classificationOf({
      classification_id: "1",
      classification_code: "VP",
      classification_desc: "Vice President",
      employer_id: "1",
      coverage_amount: 3000000,
      coverage_formula: "50% OF GTLIP",
      is_active: true,
    });

    assert.deepEqual(shown, {
      classification_id: "1",
      classification_code: "VP",
      classification_desc: "Vice President",
    });
  });
});

describe("ClassificationService.getForInvitation — the public form's list", () => {
  const listFor = (found) => {
    const { pool, calls } = fakePool({
      [TOKEN]: found === null ? [] : [found],
      [CLASSES]: byCompany,
    });

    return { calls, result: ClassificationService.getForInvitation(pool, LINK) };
  };

  test("lists the invitation's company's classes", async () => {
    const { calls, result } = listFor(invitation({ employer_id: "2" }));

    assert.deepEqual(await result, [
      { classification_id: "11", classification_code: "VP", classification_desc: "Vice President" },
    ]);
    assert.equal(inputsFor(calls, CLASSES).employer_id, "2");
  });

  // The same three refusals as GET /enrollment/invitation and the submit, so
  // the form cannot list a company's classes for a link it would refuse.
  test("a token that matches nothing is 404, and no class is read", async () => {
    const { calls, result } = listFor(null);

    await assert.rejects(
      () => result,
      (error) => error.statusCode === 404 && error.message === "Invitation not found",
    );
    assert.ok(!calls.some((call) => call.procedure === CLASSES));
  });

  for (const expired of [0, false]) {
    test(`an expired invitation is 410 when is_valid arrives as ${typeof expired} ${expired}`, async () => {
      const { calls, result } = listFor(invitation({ is_valid: expired }));

      await assert.rejects(
        () => result,
        (error) => error.statusCode === 410 && /expired/.test(error.message),
      );
      assert.ok(!calls.some((call) => call.procedure === CLASSES));
    });
  }

  for (const enrolled of [1, true]) {
    test(`a used invitation is 409 when is_enrolled arrives as ${typeof enrolled} ${enrolled}`, async () => {
      const { calls, result } = listFor(invitation({ is_enrolled: enrolled }));

      await assert.rejects(
        () => result,
        (error) => error.statusCode === 409 && /already submitted/.test(error.message),
      );
      assert.ok(!calls.some((call) => call.procedure === CLASSES));
    });
  }
});

describe("ClassificationService.getForUser — HR's list", () => {
  const listFor = (employers) => {
    const { pool, calls } = fakePool({
      [EMPLOYERS_BY_USER]: employers,
      [CLASSES]: byCompany,
    });

    return { calls, result: ClassificationService.getForUser(pool, 3) };
  };

  test("lists HR's own company's classes, without amounts", async () => {
    const { calls, result } = listFor([{ employer_id: "2" }]);

    assert.deepEqual(await result, [
      { classification_id: "11", classification_code: "VP", classification_desc: "Vice President" },
    ]);
    assert.equal(inputsFor(calls, EMPLOYERS_BY_USER).us01_user_id, 3);
    assert.equal(inputsFor(calls, CLASSES).employer_id, "2");
  });

  // The company invitations are sent under (invitationService takes the
  // first), so the list HR sees is the one their invitations draw from.
  test("an account mapped to two companies gets the first, as its invitations do", async () => {
    const { calls, result } = listFor([{ employer_id: "1" }, { employer_id: "2" }]);
    await result;

    assert.equal(inputsFor(calls, CLASSES).employer_id, "1");
  });

  test("an account with no company is 403, and no class is read", async () => {
    const { calls, result } = listFor([]);

    await assert.rejects(
      () => result,
      (error) => error.statusCode === 403 && error.message === "No company is assigned to your account",
    );
    assert.ok(!calls.some((call) => call.procedure === CLASSES));
  });
});
