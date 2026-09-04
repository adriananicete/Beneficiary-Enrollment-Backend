import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { validateEnrollment } from "../../src/middlewares/validateEnrollment.js";
import { makeNext, makeReq, makeRes } from "../helpers/http.js";

const TOKEN = "a".repeat(64);

// A payload that passes every check, so each test can break exactly one thing.
const validBody = () => ({
  token: TOKEN,
  employee_id_number: "EMP-100",
  classification_id: 1,
  first_name: "Angela",
  middle_name: "Reyes",
  last_name: "Bautista",
  suffix: "",
  birthdate: "1994-03-11",
  birthplace: "Quezon City",
  nationality: "Filipino",
  civil_status: "Single",
  gender: "F",
  height: 163.5,
  weight: 54.2,
  tin_id: "123-456-789",
  sss_gsis_no: "34-1234567-8",
  contact_no: "09171234567",
  office_no: "8123456",
  occupation: "Analyst",
  position_title: "Senior Analyst",
  source_of_income: "Employment",
  barangay_id: "012801001",
  address_line: "12 Mabini St",
  zip_code: "1100",
  signature_path: "",
  consent_privacy: true,
  consent_terms: true,
  beneficiaries: [
    { full_name: "Ricardo Bautista", relationship: "Father", age: 61, coverage_percent: 60 },
    { full_name: "Marco Bautista", relationship: "Son", age: 12, coverage_percent: 40 },
  ],
});

const run = (body) => {
  const next = makeNext();
  validateEnrollment(makeReq({ body }), makeRes(), next);
  return next;
};

describe("validateEnrollment", () => {
  test("lets a complete payload through", () => {
    assert.ok(run(validBody()).passed());
  });

  test("refuses each required field by name", () => {
    const required = [
      "employee_id_number",
      "classification_id",
      "first_name",
      "last_name",
      "birthdate",
      "gender",
      "barangay_id",
      "consent_privacy",
      "consent_terms",
    ];

    for (const field of required) {
      const body = validBody();
      delete body[field];

      const refusal = run(body).refusal();

      assert.equal(refusal.statusCode, 400, field);
      assert.match(refusal.message, new RegExp(field), field);
    }
  });

  test("middle_name, suffix and signature_path are optional at submit", () => {
    // Unlike the update path, which requires them to be present even when empty.
    const body = validBody();
    delete body.middle_name;
    delete body.suffix;
    delete body.signature_path;

    assert.ok(run(body).passed());
  });

  test("refuses a height in feet", () => {
    const refusal = run({ ...validBody(), height: 5.8 }).refusal();

    assert.equal(refusal.statusCode, 400);
    assert.match(refusal.message, /centimetres/);
  });

  test("refuses a weight outside the range", () => {
    const refusal = run({ ...validBody(), weight: 7 }).refusal();

    assert.equal(refusal.statusCode, 400);
    assert.match(refusal.message, /kilogrammes/);
  });

  test("a malformed token answers 404, not 400", () => {
    // Same answer a token that does not exist gets. A caller trying tokens
    // learns nothing from the difference.
    for (const token of ["a".repeat(65), "z".repeat(64), "not-a-token"]) {
      const refusal = run({ ...validBody(), token }).refusal();

      assert.equal(refusal.statusCode, 404, `token=${token.slice(0, 12)}`);
      assert.match(refusal.message, /Invitation not found/);
    }
  });

  test("refuses an over-length field", () => {
    const refusal = run({
      ...validBody(),
      first_name: "a".repeat(101),
    }).refusal();

    assert.equal(refusal.statusCode, 400);
    assert.match(refusal.message, /first_name/);
  });

  test("refuses beneficiary coverage that does not total 100", () => {
    const body = validBody();
    body.beneficiaries = [
      { full_name: "A", relationship: "Son", age: 10, coverage_percent: 50 },
    ];

    const refusal = run(body).refusal();

    assert.equal(refusal.statusCode, 400);
    assert.match(refusal.message, /exactly 100%/);
  });

  test("refuses a beneficiary missing a name, age or relationship", () => {
    for (const field of ["full_name", "age", "relationship"]) {
      const body = validBody();
      delete body.beneficiaries[0][field];

      const refusal = run(body).refusal();

      assert.equal(refusal.statusCode, 400, field);
      assert.match(refusal.message, /Beneficiary/, field);
    }
  });

  test("the order is load-bearing: a missing field is reported before a bad token", () => {
    // A payload broken in two ways must report the missing field first. The
    // token check answers 404, and answering 404 to a form with a blank name
    // would send the employee looking at their invitation link instead of the
    // field they left empty.
    const body = validBody();
    delete body.first_name;
    body.token = "broken";

    const refusal = run(body).refusal();

    assert.equal(refusal.statusCode, 400);
    assert.match(refusal.message, /first_name/);
  });
});
