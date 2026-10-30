import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_INVITATION_EMAILS,
  partitionInvitations,
} from "../../src/utils/partitionInvitations.js";

// The company's codes as the upload reads them: active classes from
// usp_sel_classifications_by_employer, active affiliates from
// usp_sel_employer_affiliates_by_user, ids as the driver hands them over.
const ABCC = {
  company: { employer_id: "5", company_code: "ABCC", company_name: "Abacus Book and Card Corporation" },
  classes: [
    { classification_id: "51", classification_code: "CLASS 1" },
    { classification_id: "54", classification_code: "CLASS 4" },
  ],
  affiliates: [
    { affiliate_id: "7", affiliate_code: "ALAKOR" },
    { affiliate_id: "8", affiliate_code: "ANVIL" },
  ],
};

// A company without affiliates.
const COFORGE = {
  company: { employer_id: "1", company_code: "Coforge", company_name: "Coforge BPS Philippines, Inc." },
  classes: [{ classification_id: "1", classification_code: "VP" }],
  affiliates: [],
};

const abcc = (rows) => partitionInvitations(rows, ABCC);
const coforge = (rows) => partitionInvitations(rows, COFORGE);

const row = (overrides = {}) => ({
  email_address: "juan@alakor.com.ph",
  classification_code: "CLASS 4",
  affiliate_code: "ALAKOR",
  ...overrides,
});

describe("partitionInvitations — the email, as before", () => {
  test("splits the batch instead of failing it", () => {
    // HR uploads a file, so a bad row is expected rather than exceptional. One
    // typo must not stop nine hundred good rows going out.
    const { valid, rejected } = abcc([
      row({ email_address: "one@example.com" }),
      row({ email_address: "not-an-email" }),
      row({ email_address: "two@example.com" }),
    ]);

    assert.deepEqual(valid.map((v) => v.email), ["one@example.com", "two@example.com"]);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].status, "invalid");
  });

  test("normalises the address it keeps", () => {
    const { valid } = abcc([row({ email_address: "  Angela.Bautista@Example.COM  " })]);

    assert.equal(valid[0].email, "angela.bautista@example.com");
  });

  test("reports a malformed address exactly as submitted", () => {
    // HR has to find this row in their own file. Reporting the normalised form
    // would send them looking for something they never typed.
    const { rejected } = abcc([row({ email_address: "  NOT AN EMAIL  " })]);

    assert.deepEqual(rejected[0], {
      email: "  NOT AN EMAIL  ",
      status: "invalid",
      reason: "Not a valid email address",
    });
  });

  test("catches a repeat within the same upload, whatever its codes", () => {
    const { valid, rejected } = abcc([
      row({ email_address: "same@example.com" }),
      row({ email_address: "SAME@example.com", classification_code: "CLASS 1", affiliate_code: "ANVIL" }),
    ]);

    assert.equal(valid.length, 1);
    assert.deepEqual(rejected[0], { email: "same@example.com", status: "duplicate", reason: "Repeated in this upload" });
  });

  // A row refused for its code is not "seen": the same address on a later,
  // corrected row goes out.
  test("an address refused for its code can still go out on a later row", () => {
    const { valid, rejected } = abcc([
      row({ email_address: "fixed@example.com", classification_code: "CLAS 4" }),
      row({ email_address: "fixed@example.com" }),
    ]);

    assert.equal(rejected.length, 1);
    assert.equal(valid.length, 1);
  });

  test("refuses an address longer than the column", () => {
    const long = `${"a".repeat(140)}@example.com`;
    const { rejected } = abcc([row({ email_address: long })]);

    assert.equal(rejected[0].status, "invalid");
    assert.equal(rejected[0].reason, "Longer than 150 characters");
  });

  test("shape is checked before length, so a long malformed address says malformed", () => {
    // Order is load-bearing: a 200-character string with no @ is reported as
    // not an email, not as too long, which is the more useful of the two.
    const { rejected } = abcc([row({ email_address: "x".repeat(200) })]);

    assert.equal(rejected[0].reason, "Not a valid email address");
  });

  test("an address that is not text is rejected rather than crashing the upload", () => {
    const { rejected } = abcc([null, 42, {}].map((email_address) => row({ email_address })));

    assert.equal(rejected.length, 3);
    for (const r of rejected) assert.equal(r.reason, "Not a text value");
  });

  test("a row that is not an object is rejected rather than crashing the upload", () => {
    const { rejected } = abcc([null, "juan@alakor.com.ph", ["juan@alakor.com.ph"]]);

    assert.equal(rejected.length, 3);
    for (const r of rejected) assert.equal(r.reason, "Not a row of the file");
  });

  test("an empty upload returns empty lists rather than throwing", () => {
    assert.deepEqual(abcc([]), { valid: [], rejected: [] });
  });

  test("the documented ceiling is a thousand", () => {
    assert.equal(MAX_INVITATION_EMAILS, 1000);
  });
});

describe("partitionInvitations — the class", () => {
  test("a known code gives its id", () => {
    const { valid } = abcc([row()]);

    assert.deepEqual(valid, [{ email: "juan@alakor.com.ph", classificationId: "54", affiliateId: "7" }]);
  });

  test("matches in any case and with spaces around it", () => {
    for (const code of ["class 4", "  CLASS 4 ", "Class 4"])
      assert.equal(abcc([row({ classification_code: code })]).valid[0]?.classificationId, "54", code);
  });

  test("a blank class is refused", () => {
    for (const code of [undefined, null, "", "   "]) {
      const { rejected } = abcc([row({ classification_code: code })]);

      assert.deepEqual(
        rejected[0],
        { email: "juan@alakor.com.ph", status: "invalid", reason: "Classification is required" },
        JSON.stringify(code),
      );
    }
  });

  // The reason quotes what HR wrote, trimmed, so HR can find it in the file.
  test("an unknown code is refused, quoting it", () => {
    const { rejected } = abcc([row({ classification_code: " CLAS 4 " })]);

    assert.equal(rejected[0].reason, 'Unknown classification code "CLAS 4"');
  });

  // usp_sel_classifications_by_employer answers one company's active classes,
  // so another company's code and a retired one are both unknown here.
  test("another company's class code is refused", () => {
    assert.equal(abcc([row({ classification_code: "VP" })]).rejected[0].reason, 'Unknown classification code "VP"');
  });

  // A cell Excel read as a number.
  test("a code that arrives as a number is taken as its text", () => {
    const numbered = { ...COFORGE, classes: [{ classification_id: "9", classification_code: "1" }] };
    const { valid } = partitionInvitations([row({ classification_code: 1, affiliate_code: undefined })], numbered);

    assert.equal(valid[0]?.classificationId, "9");
  });
});

describe("partitionInvitations — the affiliate, on a company that has them", () => {
  test("a known code gives its id, in any case", () => {
    for (const code of ["ANVIL", "anvil", " Anvil "])
      assert.equal(abcc([row({ affiliate_code: code })]).valid[0]?.affiliateId, "8", code);
  });

  // In HR's file the company's own code means the company itself.
  test("the company's own code, in any case, is no affiliate", () => {
    for (const code of ["ABCC", "abcc", " Abcc "]) {
      const { valid, rejected } = abcc([row({ affiliate_code: code })]);

      assert.deepEqual(rejected, [], code);
      assert.equal(valid[0].affiliateId, null, code);
    }
  });

  // A forgotten cell is caught rather than read as the company.
  test("a blank affiliate is refused", () => {
    for (const code of [undefined, null, "", "  "])
      assert.equal(
        abcc([row({ affiliate_code: code })]).rejected[0]?.reason,
        "Affiliate is required for this company",
        JSON.stringify(code),
      );
  });

  test("an unknown code is refused, quoting it", () => {
    assert.equal(abcc([row({ affiliate_code: " ALKOR " })]).rejected[0].reason, 'Unknown affiliate code "ALKOR"');
  });

  // usp_sel_employer_affiliates_by_user answers active affiliates only, and the
  // service keeps the company's own, so both are unknown here.
  test("another company's affiliate code is refused", () => {
    assert.equal(abcc([row({ affiliate_code: "QUAD" })]).rejected[0].reason, 'Unknown affiliate code "QUAD"');
  });

  // The class is judged first: one reason per row, the first thing to fix.
  test("a row wrong in both is reported for its class", () => {
    const { rejected } = abcc([row({ classification_code: "CLAS 4", affiliate_code: "ALKOR" })]);

    assert.equal(rejected[0].reason, 'Unknown classification code "CLAS 4"');
  });
});

describe("partitionInvitations — the affiliate, on a company without", () => {
  test("no Affiliate column means the company itself", () => {
    const { valid } = coforge([{ email_address: "ana@coforge.com", classification_code: "VP" }]);

    assert.deepEqual(valid, [{ email: "ana@coforge.com", classificationId: "1", affiliateId: null }]);
  });

  test("a blank affiliate is the company itself", () => {
    for (const code of [null, "", "  "])
      assert.equal(coforge([row({ classification_code: "VP", affiliate_code: code })]).valid[0]?.affiliateId, null);
  });

  // Adrian, 2026-10-15: the own code means the company everywhere.
  test("the company's own code, in any case, is accepted as the company itself", () => {
    for (const code of ["Coforge", "COFORGE", " coforge "]) {
      const { valid, rejected } = coforge([row({ classification_code: "VP", affiliate_code: code })]);

      assert.deepEqual(rejected, [], code);
      assert.equal(valid[0].affiliateId, null, code);
    }
  });

  test("any other code is refused", () => {
    assert.deepEqual(coforge([row({ classification_code: "VP", affiliate_code: "ALAKOR" })]).rejected[0], {
      email: "juan@alakor.com.ph",
      status: "invalid",
      reason: "This company has no affiliates",
    });
  });
});

describe("partitionInvitations — a mixed batch", () => {
  // The design doc's manual run, as a test: three good rows, two bad.
  test("the good rows go out and each bad row says why", () => {
    const { valid, rejected } = abcc([
      row({ email_address: "a@alakor.com.ph", classification_code: "CLASS 1", affiliate_code: "ALAKOR" }),
      row({ email_address: "b@anvil.com.ph", classification_code: "CLASS 4", affiliate_code: "ANVIL" }),
      row({ email_address: "c@abcc.com.ph", classification_code: "class 1", affiliate_code: "ABCC" }),
      row({ email_address: "d@abcc.com.ph", classification_code: "CLAS 1" }),
      row({ email_address: "e@abcc.com.ph", affiliate_code: "" }),
    ]);

    assert.deepEqual(valid, [
      { email: "a@alakor.com.ph", classificationId: "51", affiliateId: "7" },
      { email: "b@anvil.com.ph", classificationId: "54", affiliateId: "8" },
      { email: "c@abcc.com.ph", classificationId: "51", affiliateId: null },
    ]);
    assert.deepEqual(rejected, [
      { email: "d@abcc.com.ph", status: "invalid", reason: 'Unknown classification code "CLAS 1"' },
      { email: "e@abcc.com.ph", status: "invalid", reason: "Affiliate is required for this company" },
    ]);
  });
});
