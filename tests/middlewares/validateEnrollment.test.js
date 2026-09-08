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

// The rules themselves are pinned in validateBirthdate.test.js and
// validateBeneficiaryAge.test.js. These exist because a rule that is written
// and not wired in is worth nothing, and nothing else asserts the wiring.
describe("validateEnrollment — gender, civil status and zip code", () => {
  test("normalises the words the form sends into what is stored", () => {
    // The assertion that matters is on req.body afterwards, not on passing.
    // The column is char(1), so if the word reached the model it would be
    // truncated to "M" for Male and "F" for Female by coincidence — and to
    // "O" for Other, also by coincidence. Coincidence is not the same as
    // correct, and it breaks the moment a value does not start with its letter.
    const body = { ...validBody(), gender: "Male", civil_status: "married" };
    const req = makeReq({ body });
    const next = makeNext();

    validateEnrollment(req, makeRes(), next);

    assert.ok(next.passed());
    assert.equal(req.body.gender, "M");
    assert.equal(req.body.civil_status, "Married");
  });

  test("refuses a gender outside the three", () => {
    const body = { ...validBody(), gender: "X" };

    assert.match(run(body).refusal().message, /Gender must be one of/);
  });

  test("refuses a civil status outside the six, and lists them", () => {
    const body = { ...validBody(), civil_status: "Complicated" };
    const refusal = run(body).refusal();

    assert.equal(refusal.statusCode, 400);
    assert.match(refusal.message, /Legally Separated/);
  });

  test("refuses a zip code that is four characters but not four digits", () => {
    const body = { ...validBody(), zip_code: "11A0" };

    assert.match(run(body).refusal().message, /exactly 4 digits/);
  });

  test("keeps a leading zero on the zip code", () => {
    const body = { ...validBody(), zip_code: "0900" };

    assert.ok(run(body).passed());
  });
});

describe("validateEnrollment — TIN", () => {
  test("adds the dashes to a bare TIN before it is stored", () => {
    const body = { ...validBody(), tin_id: "543453566" };
    const req = makeReq({ body });
    const next = makeNext();

    validateEnrollment(req, makeRes(), next);

    assert.ok(next.passed());
    assert.equal(req.body.tin_id, "543-453-566");
  });

  test("accepts the twelve-digit form too", () => {
    assert.ok(run({ ...validBody(), tin_id: "123-456-789-000" }).passed());
  });

  test("refuses a digit count that is neither 9 nor 12", () => {
    const refusal = run({ ...validBody(), tin_id: "147-852-96" }).refusal();

    assert.equal(refusal.statusCode, 400);
    assert.match(refusal.message, /9 or 12 digits/);
  });
});

describe("validateEnrollment — contact number and SSS/GSIS", () => {
  test("folds +63 and adds the SSS dashes before storing", () => {
    const body = {
      ...validBody(),
      contact_no: "+639171234567",
      sss_gsis_no: "3398271045",
    };
    const req = makeReq({ body });
    const next = makeNext();

    validateEnrollment(req, makeRes(), next);

    assert.ok(next.passed());
    assert.equal(req.body.contact_no, "09171234567");
    assert.equal(req.body.sss_gsis_no, "33-9827104-5");
  });

  test("accepts an 11-digit GSIS number, left bare", () => {
    const body = { ...validBody(), sss_gsis_no: "12345678901" };
    const req = makeReq({ body });
    const next = makeNext();

    validateEnrollment(req, makeRes(), next);

    assert.ok(next.passed());
    assert.equal(req.body.sss_gsis_no, "12345678901");
  });

  test("refuses a landline in the mobile field", () => {
    const refusal = run({ ...validBody(), contact_no: "0281234567" }).refusal();

    assert.equal(refusal.statusCode, 400);
    assert.match(refusal.message, /starting with 09/);
  });

  test("refuses an SSS number that is neither 10 nor 11 digits", () => {
    assert.match(
      run({ ...validBody(), sss_gsis_no: "1234567890111" }).refusal().message,
      /10 digits/,
    );
  });
});

describe("validateEnrollment — office_no is not required", () => {
  test("a payload without office_no passes", () => {
    // It was required and never stored: no model binding, no parameter in
    // usp_ins_client, no column. The enrollment was being refused for a field
    // the system then threw away.
    const body = validBody();
    delete body.office_no;

    assert.ok(run(body).passed());
  });

  test("sending it anyway is harmless", () => {
    // The models bind explicitly, so an unknown field never reaches the
    // database. Pinned so removing the requirement is not mistaken for the
    // frontend having to stop sending it.
    const body = { ...validBody(), office_no: "8123456" };

    assert.ok(run(body).passed());
  });
});

describe("validateEnrollment — birthdate and age are actually applied", () => {
  test("refuses a malformed birthdate", () => {
    const body = validBody();
    body.birthdate = "11/03/1994";

    const refusal = run(body).refusal();

    assert.equal(refusal.statusCode, 400);
    assert.match(refusal.message, /YYYY-MM-DD/);
  });

  test("refuses a date that parses but is not real", () => {
    const body = validBody();
    body.birthdate = "1994-02-30";

    assert.match(run(body).refusal().message, /not a real date/);
  });

  test("refuses a birthdate in the future", () => {
    const body = validBody();
    body.birthdate = `${new Date().getFullYear() + 1}-03-11`;

    assert.match(run(body).refusal().message, /cannot be in the future/);
  });

  test("ACCEPTS a beneficiary aged 0", () => {
    // The regression this branch fixes. `if (!age)` refused a newborn with
    // "Beneficiary age is required", which was both a refusal of a valid
    // nomination and a message about the wrong thing.
    const body = validBody();
    body.beneficiaries = [
      { full_name: "Baby Bautista", relationship: "Son", age: 0, coverage_percent: 100 },
    ];

    assert.ok(run(body).passed());
  });

  test("refuses a non-numeric beneficiary age and names which one", () => {
    const body = validBody();
    body.beneficiaries[1].age = "twelve";

    const refusal = run(body).refusal();

    assert.equal(refusal.statusCode, 400);
    assert.match(refusal.message, /Beneficiary 2/);
    assert.match(refusal.message, /whole number/);
  });
});

// The signature. Optional here — the branch that makes it required in
// production is its own — but everything about its shape is decided here.
describe("validateEnrollment — the signature", () => {
  const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const JPEG_MAGIC = [0xff, 0xd8, 0xff];

  const imageBase64 = (magic, totalBytes = 256) =>
    Buffer.concat([
      Buffer.from(magic),
      Buffer.alloc(Math.max(0, totalBytes - magic.length), 0x2a),
    ]).toString("base64");

  const signed = (overrides) => {
    const req = makeReq({
      body: { ...validBody(), signature_source: "drawn", ...overrides },
    });
    const next = makeNext();

    validateEnrollment(req, makeRes(), next);

    return { req, next };
  };

  test("accepts a data URL and hands on the decoded image", () => {
    const { req, next } = signed({
      signature: `data:image/png;base64,${imageBase64(PNG_MAGIC)}`,
    });

    assert.ok(next.passed());
    assert.equal(req.signature.mimeType, "image/png");
    assert.equal(req.signature.byteSize, 256);
    assert.equal(req.signature.source, "drawn");
    assert.ok(Buffer.isBuffer(req.signature.content));
    assert.equal(req.signature.sha256.length, 64);
  });

  test("accepts a bare base64 string with no data URL prefix", () => {
    const { req, next } = signed({ signature: imageBase64(JPEG_MAGIC) });

    assert.ok(next.passed());
    assert.equal(req.signature.mimeType, "image/jpeg");
  });

  // The prefix is the caller's claim about their own file. It is stripped and
  // then never consulted — the bytes decide.
  test("ignores a data URL that lies about its type", () => {
    const { req } = signed({
      signature: `data:image/png;base64,${imageBase64(JPEG_MAGIC)}`,
    });

    assert.equal(req.signature.mimeType, "image/jpeg");
  });

  // THE REGRESSION GUARD. Every signature submitted between 2026-08-10 and
  // 2026-08-13 was cut to exactly 500 characters, because it was sent in
  // `signature_path`, which CLIENT_FIELD_LENGTHS caps at 500. A real data URL
  // is thousands of characters and must pass untouched.
  test("does not apply a string length cap to the image", () => {
    const long = `data:image/png;base64,${imageBase64(PNG_MAGIC, 40 * 1024)}`;

    assert.ok(long.length > 20000, "the fixture is too small to prove anything");

    const { req, next } = signed({ signature: long });

    assert.ok(next.passed(), "a real signature was refused for its length");
    assert.equal(req.signature.byteSize, 40 * 1024);
  });

  test("refuses something that is not an image", () => {
    const { next } = signed({
      signature: Buffer.from("this is not an image", "utf8").toString("base64"),
    });

    assert.match(next.refusal().message, /PNG or JPEG/);
  });

  test("refuses a mangled base64 string, and does not answer 500", () => {
    const { next } = signed({ signature: "!!!! not base64 !!!!" });

    assert.equal(next.refusal().statusCode, 400);
  });

  // Guessing a value for the one field that records how the signature was
  // captured would put a fabricated answer in an audit trail.
  for (const [label, source] of [
    ["missing", undefined],
    ["empty", ""],
    ["not one of the two", "scanned"],
  ]) {
    test(`refuses a signature whose source is ${label}`, () => {
      const { next } = signed({
        signature: imageBase64(PNG_MAGIC),
        signature_source: source,
      });

      assert.match(next.refusal().message, /signature_source/);
    });
  }

  test("a payload with no signature still passes, and attaches nothing", () => {
    const { req, next } = signed({});

    assert.ok(next.passed());
    assert.equal(req.signature, undefined);
  });

  test("an empty signature is treated as absent rather than as a bad image", () => {
    const { req, next } = signed({ signature: "" });

    assert.ok(next.passed());
    assert.equal(req.signature, undefined);
  });

  // Required in production, optional elsewhere. The gate exists so development
  // and this suite can submit without building an image every time — it is not
  // a rollout mechanism, because it is production that breaks if the frontend
  // is not sending one.
  describe("required in production", () => {
    // Set and restored here rather than read from the runner, so the test says
    // what it depends on instead of inheriting it.
    const withNodeEnv = (value, run) => {
      const original = process.env.NODE_ENV;
      process.env.NODE_ENV = value;

      try {
        run();
      } finally {
        process.env.NODE_ENV = original;
      }
    };

    test("refuses a submission with no signature", () => {
      withNodeEnv("production", () => {
        const { next } = signed({});

        assert.equal(next.refusal().statusCode, 400);
        assert.match(next.refusal().message, /signature is required/i);
      });
    });

    test("refuses an empty string too, which is what the old field held", () => {
      withNodeEnv("production", () => {
        assert.match(signed({ signature: "" }).next.refusal().message, /required/i);
      });
    });

    test("accepts one that is present and valid", () => {
      withNodeEnv("production", () => {
        const { req, next } = signed({ signature: imageBase64(PNG_MAGIC) });

        assert.ok(next.passed());
        assert.equal(req.signature.mimeType, "image/png");
      });
    });

    // A bad image in production must still say what is wrong with it, rather
    // than falling through to "a signature is required" — which would send the
    // employee back to do the thing they already did.
    test("still names the real problem when a signature is present but wrong", () => {
      withNodeEnv("production", () => {
        const { next } = signed({
          signature: Buffer.from("not an image", "utf8").toString("base64"),
        });

        assert.match(next.refusal().message, /PNG or JPEG/);
      });
    });

    for (const env of ["development", "test"]) {
      test(`lets a signature-less submission through in ${env}`, () => {
        withNodeEnv(env, () => {
          assert.ok(signed({}).next.passed());
        });
      });
    }
  });
});
