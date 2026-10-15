import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { makeNext, makeReq, makeRes } from "../helpers/http.js";
import { validateCompanyChanges, validateNewCompany } from "../../src/middlewares/validateCompany.js";

// The Administrator's company form, branch 2 of the onboarding effort. Widths
// are the dbo.employers columns: code 20, name 200, address 255, office no.
// 30, policy no. 12.

const company = (overrides = {}) => ({
  company_code: "ABCC",
  company_name: "Abacus Book and Card Corporation",
  work_address: "Mandaluyong City",
  office_no: "8-123-4567",
  policy_no: "G-TLI-26-177",
  send_coc_email: true,
  online_enrollment_max_age: 65,
  ...overrides,
});

const run = (middleware, body) => {
  const req = makeReq({ body });
  const next = makeNext();
  middleware(req, makeRes(), next);
  return { req, next };
};

describe("validateNewCompany — a whole company", () => {
  test("a complete company passes", () => {
    assert.ok(run(validateNewCompany, company()).next.passed());
  });

  test("every text field is trimmed before it is checked and stored", () => {
    const { req, next } = run(validateNewCompany, company({ company_code: "  ABCC ", policy_no: " G-TLI-26-177  " }));

    assert.ok(next.passed());
    assert.equal(req.body.company_code, "ABCC");
    assert.equal(req.body.policy_no, "G-TLI-26-177");
  });

  // The optional three get their defaults, so the procedure receives all seven.
  test("the optional fields default: CoC email on, no office no., no age limit", () => {
    const body = company();
    delete body.send_coc_email;
    delete body.office_no;
    delete body.online_enrollment_max_age;

    const { req, next } = run(validateNewCompany, body);

    assert.ok(next.passed());
    assert.equal(req.body.send_coc_email, true);
    assert.equal(req.body.office_no, null);
    assert.equal(req.body.online_enrollment_max_age, null);
  });

  test("an empty optional field means none", () => {
    const { req, next } = run(validateNewCompany, company({ office_no: "  ", online_enrollment_max_age: "" }));

    assert.ok(next.passed());
    assert.equal(req.body.office_no, null);
    assert.equal(req.body.online_enrollment_max_age, null);
  });

  for (const field of ["company_code", "company_name", "work_address", "policy_no"])
    test(`${field} is required, and blank counts as missing`, () => {
      for (const value of [undefined, null, "", "   "]) {
        const body = company({ [field]: value });
        if (value === undefined) delete body[field];

        assert.deepEqual(
          run(validateNewCompany, body).next.refusal(),
          { statusCode: 400, message: `${field} is required` },
          JSON.stringify(value),
        );
      }
    });

  for (const [field, max] of [["company_code", 20], ["company_name", 200], ["work_address", 255], ["office_no", 30], ["policy_no", 12]])
    test(`${field} is at most ${max} characters`, () => {
      const fits = field === "company_code" ? "A".repeat(max) : "x".repeat(max);
      assert.ok(run(validateNewCompany, company({ [field]: fits })).next.passed());

      assert.deepEqual(run(validateNewCompany, company({ [field]: fits + "x" })).next.refusal(), {
        statusCode: 400,
        message: `${field} must not exceed ${max} characters`,
      });
    });

  // It becomes part of the HR username in branch 4.
  test("the code is letters, digits and hyphens only", () => {
    for (const code of ["ABCC", "Coforge", "HCL", "NBS-2"])
      assert.ok(run(validateNewCompany, company({ company_code: code })).next.passed(), code);

    for (const code of ["AB CC", "ABCC.", "hr.abcc", "AB_CC", "ÁBCC"])
      assert.equal(run(validateNewCompany, company({ company_code: code })).next.refusal()?.statusCode, 400, code);
  });

  test("the policy number has no spaces", () => {
    assert.deepEqual(run(validateNewCompany, company({ policy_no: "G-TLI 26-177" })).next.refusal(), {
      statusCode: 400,
      message: "policy_no may only contain letters, digits and symbols, with no spaces",
    });
  });

  test("a text field must be text", () => {
    assert.deepEqual(run(validateNewCompany, company({ company_name: 42 })).next.refusal(), {
      statusCode: 400,
      message: "company_name must be text",
    });
  });

  test("send_coc_email is a real boolean and nothing else", () => {
    for (const value of ["false", "true", 0, 1, null])
      assert.equal(run(validateNewCompany, company({ send_coc_email: value })).next.refusal()?.statusCode, 400, JSON.stringify(value));
  });

  test("the age limit is empty, or a whole number from 18 to 100", () => {
    for (const age of [18, 65, 100, null])
      assert.ok(run(validateNewCompany, company({ online_enrollment_max_age: age })).next.passed(), String(age));

    for (const age of [17, 101, 65.5, "65", true, -1])
      assert.equal(run(validateNewCompany, company({ online_enrollment_max_age: age })).next.refusal()?.statusCode, 400, JSON.stringify(age));
  });

  // A misspelt key is refused, not dropped with the value it carried.
  test("a field the form does not have is refused by name", () => {
    assert.deepEqual(run(validateNewCompany, company({ policy_number: "G-TLI-26-177" })).next.refusal(), {
      statusCode: 400,
      message: "policy_number is not a company field",
    });

    // status is not editable here: deactivating a company is not in the design.
    assert.equal(run(validateNewCompany, company({ status: "I" })).next.refusal()?.statusCode, 400);
  });

  test("a body that is not an object is refused", () => {
    for (const body of [undefined, null, [], "ABCC"])
      assert.deepEqual(run(validateNewCompany, body).next.refusal(), {
        statusCode: 400,
        message: "The request body must be an object",
      });
  });
});

describe("validateCompanyChanges — part of a company", () => {
  test("one field alone passes, and nothing else is required", () => {
    assert.ok(run(validateCompanyChanges, { work_address: "Pasig City" }).next.passed());
  });

  test("an empty change is refused", () => {
    assert.deepEqual(run(validateCompanyChanges, {}).next.refusal(), { statusCode: 400, message: "Nothing to change" });
  });

  // Clearing is what a PATCH is for on the two optional fields.
  test("the optional fields can be cleared", () => {
    const { req, next } = run(validateCompanyChanges, { office_no: "", online_enrollment_max_age: null });

    assert.ok(next.passed());
    assert.equal(req.body.office_no, null);
    assert.equal(req.body.online_enrollment_max_age, null);
  });

  // A required field sent empty is not "leave it alone".
  test("a required field cannot be cleared", () => {
    assert.deepEqual(run(validateCompanyChanges, { company_name: "  " }).next.refusal(), {
      statusCode: 400,
      message: "company_name is required",
    });
  });

  test("each field sent is checked by the same rule as on create", () => {
    assert.equal(run(validateCompanyChanges, { policy_no: "G-TLI-26-1777" }).next.refusal()?.statusCode, 400);
    assert.equal(run(validateCompanyChanges, { send_coc_email: "false" }).next.refusal()?.statusCode, 400);
    assert.equal(run(validateCompanyChanges, { online_enrollment_max_age: 101 }).next.refusal()?.statusCode, 400);
  });

  test("a field the form does not have is refused by name", () => {
    assert.deepEqual(run(validateCompanyChanges, { employer_id: "1", company_name: "X" }).next.refusal(), {
      statusCode: 400,
      message: "employer_id is not a company field",
    });
  });
});
