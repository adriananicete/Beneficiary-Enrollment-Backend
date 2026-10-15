import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { makeNext, makeReq, makeRes } from "../helpers/http.js";
import { validateAffiliateChanges, validateNewAffiliate } from "../../src/middlewares/validateAffiliate.js";

// A company's affiliates, branch 5 of the onboarding effort. Widths are the
// dbo.employer_affiliates columns, read 2026-10-15: code 20, name 200,
// reference 20.

const affiliate = (overrides = {}) => ({
  affiliate_code: "ALAKOR",
  affiliate_name: "Alakor Corporation",
  reference_no: "G-TLI-26-177-1",
  ...overrides,
});

const run = (middleware, body) => {
  const req = makeReq({ body });
  const next = makeNext();
  middleware(req, makeRes(), next);
  return { req, next };
};

describe("validateNewAffiliate — a whole affiliate", () => {
  test("a complete affiliate passes", () => {
    assert.ok(run(validateNewAffiliate, affiliate()).next.passed());
  });

  test("every text field is trimmed before it is checked and stored", () => {
    const { req, next } = run(
      validateNewAffiliate,
      affiliate({ affiliate_code: " ALAKOR  ", affiliate_name: "  Alakor Corporation ", reference_no: " G-TLI-26-177-1 " }),
    );

    assert.ok(next.passed());
    assert.equal(req.body.affiliate_code, "ALAKOR");
    assert.equal(req.body.affiliate_name, "Alakor Corporation");
    assert.equal(req.body.reference_no, "G-TLI-26-177-1");
  });

  // The procedure takes all three, so the reference reaches it as null rather
  // than missing.
  test("the reference is optional, and missing or blank means none", () => {
    for (const value of [undefined, null, "", "   "]) {
      const body = affiliate({ reference_no: value });
      if (value === undefined) delete body.reference_no;

      const { req, next } = run(validateNewAffiliate, body);

      assert.ok(next.passed(), JSON.stringify(value));
      assert.equal(req.body.reference_no, null, JSON.stringify(value));
    }
  });

  for (const field of ["affiliate_code", "affiliate_name"])
    test(`${field} is required, and blank counts as missing`, () => {
      for (const value of [undefined, null, "", "   "]) {
        const body = affiliate({ [field]: value });
        if (value === undefined) delete body[field];

        assert.deepEqual(
          run(validateNewAffiliate, body).next.refusal(),
          { statusCode: 400, message: `${field} is required` },
          JSON.stringify(value),
        );
      }
    });

  for (const [field, max] of [["affiliate_code", 20], ["affiliate_name", 200], ["reference_no", 20]])
    test(`${field} is at most ${max} characters`, () => {
      const fits = field === "affiliate_name" ? "x".repeat(max) : "A".repeat(max);
      assert.ok(run(validateNewAffiliate, affiliate({ [field]: fits })).next.passed());

      assert.deepEqual(run(validateNewAffiliate, affiliate({ [field]: fits + "A" })).next.refusal(), {
        statusCode: 400,
        message: `${field} must not exceed ${max} characters`,
      });
    });

  // What HR writes in the Affiliate column of its file.
  test("the code is letters, digits and hyphens only", () => {
    for (const code of ["ALAKOR", "Anvil", "ABCC-2", "x1"])
      assert.ok(run(validateNewAffiliate, affiliate({ affiliate_code: code })).next.passed(), code);

    for (const code of ["ALA KOR", "ALAKOR.", "AL_AKOR", "ÁLAKOR", "ALAKOR,"])
      assert.deepEqual(
        run(validateNewAffiliate, affiliate({ affiliate_code: code })).next.refusal(),
        { statusCode: 400, message: "affiliate_code may only contain letters, digits and hyphens" },
        code,
      );
  });

  test("the reference has no spaces", () => {
    assert.deepEqual(run(validateNewAffiliate, affiliate({ reference_no: "G-TLI-26-177 1" })).next.refusal(), {
      statusCode: 400,
      message: "reference_no may only contain letters, digits and symbols, with no spaces",
    });
  });

  test("a text field must be text", () => {
    for (const field of ["affiliate_code", "affiliate_name", "reference_no"])
      assert.deepEqual(run(validateNewAffiliate, affiliate({ [field]: 42 })).next.refusal(), {
        statusCode: 400,
        message: `${field} must be text`,
      });
  });

  // A new affiliate is active; is_active is for the PATCH.
  test("a field the form does not have is refused by name, is_active included", () => {
    assert.deepEqual(run(validateNewAffiliate, affiliate({ reference: "G-TLI-26-177-1" })).next.refusal(), {
      statusCode: 400,
      message: "reference is not a field of a new affiliate",
    });

    assert.deepEqual(run(validateNewAffiliate, affiliate({ is_active: false })).next.refusal(), {
      statusCode: 400,
      message: "is_active is not a field of a new affiliate",
    });
  });

  test("a body that is not an object is refused", () => {
    for (const body of [undefined, null, [], "ALAKOR"])
      assert.deepEqual(run(validateNewAffiliate, body).next.refusal(), {
        statusCode: 400,
        message: "The request body must be an object",
      });
  });
});

describe("validateAffiliateChanges — part of an affiliate", () => {
  test("one field alone passes, and nothing else is required", () => {
    assert.ok(run(validateAffiliateChanges, { affiliate_name: "Alakor Corp." }).next.passed());
  });

  test("an empty change is refused", () => {
    assert.deepEqual(run(validateAffiliateChanges, {}).next.refusal(), { statusCode: 400, message: "Nothing to change" });
  });

  test("deactivating and restoring take a real boolean and nothing else", () => {
    assert.ok(run(validateAffiliateChanges, { is_active: false }).next.passed());
    assert.ok(run(validateAffiliateChanges, { is_active: true }).next.passed());

    for (const value of ["false", "true", 0, 1, null])
      assert.deepEqual(
        run(validateAffiliateChanges, { is_active: value }).next.refusal(),
        { statusCode: 400, message: "is_active must be true or false" },
        JSON.stringify(value),
      );
  });

  // Clearing is what a PATCH is for on the one optional field.
  test("the reference can be cleared, blank or null", () => {
    for (const value of ["", "  ", null]) {
      const { req, next } = run(validateAffiliateChanges, { reference_no: value });

      assert.ok(next.passed(), JSON.stringify(value));
      assert.equal(req.body.reference_no, null, JSON.stringify(value));
    }
  });

  // A required field sent empty is not "leave it alone".
  test("a required field cannot be cleared", () => {
    assert.deepEqual(run(validateAffiliateChanges, { affiliate_code: "  " }).next.refusal(), {
      statusCode: 400,
      message: "affiliate_code is required",
    });
  });

  test("each field sent is checked by the same rule as on create", () => {
    assert.equal(run(validateAffiliateChanges, { affiliate_code: "ALA KOR" }).next.refusal()?.statusCode, 400);
    assert.equal(run(validateAffiliateChanges, { affiliate_name: "x".repeat(201) }).next.refusal()?.statusCode, 400);
    assert.equal(run(validateAffiliateChanges, { reference_no: "G-TLI 26" }).next.refusal()?.statusCode, 400);
  });

  test("a field the form does not have is refused by name", () => {
    assert.deepEqual(run(validateAffiliateChanges, { employer_id: "2", affiliate_name: "X" }).next.refusal(), {
      statusCode: 400,
      message: "employer_id is not an affiliate field",
    });
  });
});
