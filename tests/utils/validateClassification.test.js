import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  classificationChangesProblem,
  newClassificationProblem,
} from "../../src/utils/validateClassification.js";

// A company's classes and amounts, as the Administrator enters them. The four
// benefits only; GTLIP required; amounts in whole pesos above zero; GTIR a
// formula of at most 100 characters (the column).

const newClass = (overrides = {}) => ({
  classification_code: "CLASS 1",
  classification_desc: "Officers",
  benefits: { GTLIP: 120000, GTPDR: 120000, ALCR: 10000, GTIR: "50% of GTLIP" },
  ...overrides,
});

describe("a new classification", () => {
  test("a complete class passes, and so does one with GTLIP alone", () => {
    assert.equal(newClassificationProblem(newClass()), null);
    assert.equal(newClassificationProblem(newClass({ benefits: { GTLIP: 500000 } })), null);
  });

  test("the code and description are trimmed", () => {
    const body = newClass({ classification_code: "  CLASS 1 ", classification_desc: " Officers  " });

    assert.equal(newClassificationProblem(body), null);
    assert.equal(body.classification_code, "CLASS 1");
    assert.equal(body.classification_desc, "Officers");
  });

  test("GTLIP is required", () => {
    assert.equal(newClassificationProblem(newClass({ benefits: { GTPDR: 100 } })), "GTLIP is required");
  });

  test("a fifth benefit is refused by name", () => {
    assert.equal(
      newClassificationProblem(newClass({ benefits: { GTLIP: 1, GCLIP: 1 } })),
      "GCLIP is not a benefit. The benefits are GTLIP, GTPDR, ALCR and GTIR",
    );
  });

  // Whole pesos above zero, as a JSON number.
  test("an amount of zero, a negative, a fraction or a string is refused", () => {
    for (const amount of [0, -1, 1000.5, "120000", null, Number.MAX_SAFE_INTEGER + 1])
      assert.equal(
        newClassificationProblem(newClass({ benefits: { GTLIP: amount } })),
        amount === null
          ? "GTLIP cannot be empty. Leave out a benefit the class does not have"
          : "GTLIP must be a whole number of pesos above zero",
        JSON.stringify(amount),
      );
  });

  test("GTIR is a formula, not a number, and is trimmed", () => {
    assert.match(newClassificationProblem(newClass({ benefits: { GTLIP: 1, GTIR: 60000 } })), /GTIR must be a formula/);

    const body = newClass({ benefits: { GTLIP: 1, GTIR: "  50% OF GTLIP " } });
    assert.equal(newClassificationProblem(body), null);
    assert.equal(body.benefits.GTIR, "50% OF GTLIP");
  });

  test("GTIR is at most 100 characters, and not blank", () => {
    assert.equal(newClassificationProblem(newClass({ benefits: { GTLIP: 1, GTIR: "x".repeat(100) } })), null);
    assert.match(newClassificationProblem(newClass({ benefits: { GTLIP: 1, GTIR: "x".repeat(101) } })), /1 to 100/);
    assert.match(newClassificationProblem(newClass({ benefits: { GTLIP: 1, GTIR: "   " } })), /1 to 100/);
  });

  test("the code is required and at most 20 characters; the description at most 200", () => {
    assert.equal(newClassificationProblem(newClass({ classification_code: " " })), "classification_code is required");
    assert.equal(newClassificationProblem(newClass({ classification_code: "x".repeat(20) })), null);
    assert.equal(
      newClassificationProblem(newClass({ classification_code: "x".repeat(21) })),
      "classification_code must not exceed 20 characters",
    );
    assert.equal(
      newClassificationProblem(newClass({ classification_desc: "x".repeat(201) })),
      "classification_desc must not exceed 200 characters",
    );
  });

  // A new class is active; a field the form does not have is refused rather
  // than dropped.
  test("is_active and unknown fields are refused", () => {
    assert.match(newClassificationProblem(newClass({ is_active: false })), /is_active is not a field/);
    assert.match(newClassificationProblem(newClass({ employer_id: "1" })), /employer_id is not a field/);
  });

  test("benefits must be an object", () => {
    for (const benefits of [undefined, null, [], "GTLIP"])
      assert.equal(newClassificationProblem(newClass({ benefits })), "benefits must be an object", JSON.stringify(benefits));
  });
});

describe("changes to a classification", () => {
  test("any one part passes on its own", () => {
    assert.equal(classificationChangesProblem({ classification_desc: "Managers" }), null);
    assert.equal(classificationChangesProblem({ is_active: false }), null);
    assert.equal(classificationChangesProblem({ benefits: { GTLIP: 150000 } }), null);
  });

  test("nothing to change is refused, including an empty benefits object", () => {
    assert.equal(classificationChangesProblem({}), "Nothing to change");
    assert.equal(classificationChangesProblem({ benefits: {} }), "Nothing to change");
  });

  // null removes a benefit from the class. GTLIP is the one every class has.
  test("a benefit sent as null is a removal, except GTLIP", () => {
    assert.equal(classificationChangesProblem({ benefits: { ALCR: null, GTIR: null } }), null);
    assert.equal(classificationChangesProblem({ benefits: { GTLIP: null } }), "GTLIP cannot be removed");
  });

  test("each value sent is checked as on create", () => {
    assert.match(classificationChangesProblem({ benefits: { GTPDR: 0 } }), /whole number of pesos/);
    assert.match(classificationChangesProblem({ benefits: { GTIR: 5 } }), /formula/);
    assert.equal(classificationChangesProblem({ classification_code: "" }), "classification_code is required");
    assert.equal(classificationChangesProblem({ is_active: "false" }), "is_active must be true or false");
  });

  test("benefits sent as something other than an object is refused", () => {
    assert.equal(classificationChangesProblem({ benefits: null }), "benefits must be an object");
  });

  test("an unknown field is refused by name", () => {
    assert.equal(classificationChangesProblem({ coverage_amount: 1 }), "coverage_amount is not a classification field");
  });
});
