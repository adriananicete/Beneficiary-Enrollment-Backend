import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { validateEnrollmentUpdate } from "../../src/middlewares/validateEnrollmentUpdate.js";
import { makeNext, makeReq, makeRes } from "../helpers/http.js";

// The frontend sends the full personal payload from the pre-filled form, not
// just the changed field. That is the direct consequence of usp_upd_client
// having no ISNULL coalescing — a partial payload would blank out every field
// it left out.
const validBody = () => ({
  first_name: "Angela",
  middle_name: "Reyes",
  last_name: "Bautista",
  suffix: "",
  signature_path: "",
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
  email_address: "angela@example.com",
  occupation: "Analyst",
  source_of_income: "Employment",
});

const run = (body) => {
  const next = makeNext();
  validateEnrollmentUpdate(makeReq({ body }), makeRes(), next);
  return next;
};

describe("validateEnrollmentUpdate", () => {
  test("lets a full personal payload through", () => {
    assert.ok(run(validBody()).passed());
  });

  test("middle_name, suffix and signature_path must be present but may be empty", () => {
    // The distinction that matters: absent means "the form did not send it",
    // which would clear a real value. Empty means "the employee cleared it",
    // which is a legitimate edit.
    for (const field of ["middle_name", "suffix", "signature_path"]) {
      const body = validBody();
      delete body[field];

      const refusal = run(body).refusal();

      assert.equal(refusal.statusCode, 400, field);
      assert.match(refusal.message, /must be included in the update/, field);

      assert.ok(run({ ...validBody(), [field]: "" }).passed(), `${field} empty`);
    }
  });

  test("refuses each required personal field", () => {
    for (const field of ["first_name", "last_name", "birthdate", "email_address", "tin_id"]) {
      const body = validBody();
      delete body[field];

      const refusal = run(body).refusal();

      assert.equal(refusal.statusCode, 400, field);
      assert.match(refusal.message, new RegExp(field), field);
    }
  });

  test("the address block is only required when an address is being changed", () => {
    // No client_address_id means the employee is not touching their address,
    // so barangay_id and the rest are not expected.
    assert.ok(run(validBody()).passed());

    const withAddress = {
      ...validBody(),
      client_address_id: "71",
    };

    const refusal = run(withAddress).refusal();

    assert.equal(refusal.statusCode, 400);
    assert.match(refusal.message, /barangay_id|address_line|zip_code/);
  });

  test("a complete address block passes", () => {
    assert.ok(
      run({
        ...validBody(),
        client_address_id: "71",
        barangay_id: "012801001",
        address_line: "12 Mabini St",
        zip_code: "1100",
      }).passed(),
    );
  });

  test("beneficiaries are optional, but validated when sent", () => {
    assert.ok(run(validBody()).passed());

    const refusal = run({
      ...validBody(),
      beneficiaries: [
        { full_name: "A", relationship: "Son", age: 10, coverage_percent: 50 },
      ],
    }).refusal();

    assert.match(refusal.message, /exactly 100%/);
  });

  test("an empty beneficiary list is allowed — removing everyone is a real edit", () => {
    assert.ok(run({ ...validBody(), beneficiaries: [] }).passed());
  });

  test("refuses a height or weight outside its range", () => {
    assert.match(run({ ...validBody(), height: 5.8 }).refusal().message, /centimetres/);
    assert.match(run({ ...validBody(), weight: 400 }).refusal().message, /kilogrammes/);
  });

  test("a missing height is reported as missing, not as out of range", () => {
    // The height check runs after the required-field loop for exactly this
    // reason. "height is required" is actionable; "must be between 100 and 250"
    // in front of an empty box is not.
    const body = validBody();
    delete body.height;

    assert.match(run(body).refusal().message, /height is required/);
  });
});
