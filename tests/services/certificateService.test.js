import { describe, test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import "../helpers/env.js";
import { fakePool, inputsFor } from "../helpers/fakePool.js";
import { pdfText, compact } from "../helpers/pdfRuns.js";

const { default: config } = await import("../../src/config/env.js");
const {
  buildCertificateData,
  buildCertificate,
  certificateForDecision,
  resendCertificate,
  tryBuildCertificate,
  formatCoverageDate,
  certificateFileName,
} = await import("../../src/services/certificateService.js");

// What the certificate says, as opposed to where it says it — the layout is
// certificatePdf.test.js. Everything here comes from three procedures, and the
// rows below are the real ones for enrollment 74, the example the format was
// copied from: pasted from GET /admin/enrollments/96 on 2026-09-11.

const DETAILS = "usp_get_insurance_enrollment_by_id";
const BENEFITS = "usp_get_enrollment_benefits_by_id";
const BENEFICIARIES = "usp_sel_beneficiaries";

// mssql hands a datetime back as a Date labelled UTC, holding the wall-clock
// time the database wrote with getdate(): 13:18 local arrives as 13:18Z.
const enrollmentRow = (overrides = {}) => ({
  enrollment_id: "74",
  client_id: "96",
  policy_no: "G-TLI-26-136-2600030",
  group_policy_no: "G-TLI-26-136",
  first_name: "Lorenz",
  middle_name: "Adrian",
  last_name: "Artillagas",
  suffix: "",
  full_address: "Celina Homes 5",
  brgy_name: "Tagapo",
  city_municipality_name: "City Of Santa Rosa",
  province_name: "Laguna",
  region_name: "Region IV-A (CALABARZON)",
  zip_code: "4026",
  company_name: "Coforge BPS Philippines, Inc.",
  email_address: "lorenz@coforge.com",
  enrollment_date: new Date("2026-09-11T13:18:06.510Z"),
  ...overrides,
});

const BENEFIT_ROWS = [
  { benefit_name: "GTLIP", benefit_description: "Group Term Life Insurance Plan", coverage_amount: 500000, coverage_formula: null },
  { benefit_name: "GTPDR", benefit_description: "Group Total and Permanent Disability Rider", coverage_amount: 500000, coverage_formula: null },
  { benefit_name: "GTLI – Additional Life", benefit_description: "Additional/Life Coverage", coverage_amount: 55000, coverage_formula: null },
  { benefit_name: "GTIR", benefit_description: "Group Terminal Illness Rider", coverage_amount: null, coverage_formula: "50% OF GTLIP" },
];

const beneficiary = (full_name, relationship, coverage_percent) => ({
  full_name,
  relationship,
  coverage_percent,
});

const poolFor = ({ details = [enrollmentRow()], benefits = BENEFIT_ROWS, beneficiaries = [beneficiary("Christine Fadul", "Spouse", 100)] } = {}) =>
  fakePool({
    [DETAILS]: details,
    [BENEFITS]: benefits,
    [BENEFICIARIES]: beneficiaries,
  });

describe("certificateService — what the certificate says", () => {
  test("enrollment 74 comes out as the example prints it", async () => {
    const { pool } = poolFor();

    const data = await buildCertificateData(pool, 96);

    assert.equal(data.policyNo, "G-TLI-26-136-2600030");
    assert.equal(data.companyName, "Coforge BPS Philippines, Inc.");
    assert.equal(data.insuredName, "Lorenz Adrian Artillagas");
    assert.equal(
      data.address,
      "Celina Homes 5, Tagapo, City Of Santa Rosa, Laguna, Region IV-A (CALABARZON), 4026",
    );
    assert.equal(data.coverageDate, "September 11, 2026");
    assert.equal(data.premium, "—");
    assert.deepEqual(data.coverages, [
      { label: "Group Term Life Insurance Plan (GTLIP)", amount: "P 500,000" },
      { label: "Group Total and Permanent Disability Rider (GTPDR)", amount: "P 500,000" },
      { label: "GTLI – Additional Life", amount: "P 55,000" },
      { label: "Group Terminal Illness Rider (GTIR)", amount: "50% OF GTLIP" },
    ]);
    assert.deepEqual(data.dependentColumns, ["GTLIP", "GTPDR", "GTLI – Additional Life"]);
    assert.deepEqual(data.dependents, [
      { name: "Christine Fadul", relationship: "Spouse", amounts: ["500,000", "500,000", "55,000"] },
    ]);
  });

  // The example printed the employee's own number here, twice on one page. The
  // Group Policy No. is the company's — employers.policy_no — and the two are
  // not the same string.
  test("the Group Policy No. is the company's, not the employee's", async () => {
    const { pool } = poolFor();

    const data = await buildCertificateData(pool, 96);

    assert.equal(data.groupPolicyNo, "G-TLI-26-136");
    assert.notEqual(data.groupPolicyNo, data.policyNo);
  });

  // Decided on 2026-09-11: the formula prints as stored, not as the example's
  // lower case.
  test("prints the Terminal Illness formula exactly as stored", async () => {
    const { pool } = poolFor();

    const { coverages } = await buildCertificateData(pool, 96);

    assert.equal(coverages.at(-1).amount, "50% OF GTLIP");
  });

  test("a formula-only benefit has no column in the dependents table", async () => {
    const { pool } = poolFor();

    const { dependentColumns } = await buildCertificateData(pool, 96);

    assert.ok(!dependentColumns.includes("GTIR"));
  });

  // Each dependent's share is the benefit times their coverage percent.
  test("splits every amount by coverage percent", async () => {
    const { pool } = poolFor({
      beneficiaries: [beneficiary("Maria Artillagas", "Mother", 60), beneficiary("Jose Artillagas", "Father", 40)],
    });

    const { dependents } = await buildCertificateData(pool, 96);

    assert.deepEqual(dependents[0].amounts, ["300,000", "300,000", "33,000"]);
    assert.deepEqual(dependents[1].amounts, ["200,000", "200,000", "22,000"]);
  });

  // A share that does not land on a whole peso prints both decimals — never
  // "8,333.3", and never rounded away to a number that was not covered.
  test("prints centavos when a share has them", async () => {
    const { pool } = poolFor({
      benefits: [{ ...BENEFIT_ROWS[0], coverage_amount: 55555 }],
      beneficiaries: [beneficiary("Christine Fadul", "Spouse", 15)],
    });

    const { dependents } = await buildCertificateData(pool, 96);

    assert.deepEqual(dependents[0].amounts, ["8,333.25"]);
  });

  test("leaves out the parts of an address that are empty", async () => {
    const { pool } = poolFor({
      details: [enrollmentRow({ brgy_name: null, province_name: "  ", zip_code: "" })],
    });

    const { address } = await buildCertificateData(pool, 96);

    assert.equal(address, "Celina Homes 5, City Of Santa Rosa, Region IV-A (CALABARZON)");
  });

  test("reads the beneficiaries of the enrollment it found", async () => {
    const { pool, calls } = poolFor();

    await buildCertificateData(pool, 96);

    assert.equal(inputsFor(calls, DETAILS).client_id, 96);
    assert.equal(inputsFor(calls, BENEFICIARIES).enrollment_id, "74");
  });
});

describe("certificateService — the coverage date", () => {
  // The trap: 17:30 local arrives as 17:30Z. Read in Asia/Manila it becomes
  // 01:30 the next morning, and the certificate would say the cover began a
  // day after it did. Anything after 16:00 local shows it.
  test("an enrollment late in the afternoon keeps its own date", () => {
    assert.equal(formatCoverageDate(new Date("2026-09-11T17:30:00.000Z")), "September 11, 2026");
  });

  test("so does one just before midnight", () => {
    assert.equal(formatCoverageDate(new Date("2026-09-11T23:59:59.000Z")), "September 11, 2026");
  });

  test("accepts the ISO string form as well as a Date", () => {
    assert.equal(formatCoverageDate("2026-09-11T13:18:06.510Z"), "September 11, 2026");
  });
});

describe("certificateService — refusing to print a wrong certificate", () => {
  test("refuses a client with no enrollment, and asks nothing further", async () => {
    const { pool, calls } = poolFor({ details: [] });

    await assert.rejects(
      () => buildCertificateData(pool, 96),
      (error) => error.statusCode === 404,
    );
    assert.ok(!calls.some((call) => call.procedure === BENEFITS));
  });

  // Blank is worse than absent: a certificate with no number on it looks
  // issued and cannot be traced to a policy.
  for (const field of ["policy_no", "group_policy_no"]) {
    test(`refuses an enrollment with no ${field}`, async () => {
      const { pool } = poolFor({ details: [enrollmentRow({ [field]: null })] });

      await assert.rejects(
        () => buildCertificateData(pool, 96),
        (error) => error.statusCode === 409 && /policy number/.test(error.message),
      );
    });
  }

  // The benefits procedure filters on the classification being active, so a
  // classification deactivated after enrollment returns nothing at all.
  test("refuses an enrollment whose benefits came back empty", async () => {
    const { pool } = poolFor({ benefits: [] });

    await assert.rejects(
      () => buildCertificateData(pool, 96),
      (error) => error.statusCode === 409 && /no active benefits/.test(error.message),
    );
  });
});

describe("certificateService — the attachment", () => {
  const originalPath = config.certificateSignaturePath;
  afterEach(() => {
    config.certificateSignaturePath = originalPath;
  });

  // The middle name, "Adrian", is on the record and stays out of the name.
  test("is a PDF named after the policy and the employee, carrying its numbers", async () => {
    const { pool } = poolFor();

    const attachment = await buildCertificate(pool, 96);

    assert.equal(attachment.name, "G-TLI-26-136-2600030-Lorenz-Artillagas.pdf");
    assert.equal(attachment.contentType, "application/pdf");
    assert.equal(attachment.content.subarray(0, 5).toString(), "%PDF-");

    const text = pdfText(attachment.content);
    assert.ok(text.includes(compact("No. G-TLI-26-136-2600030")));
    assert.ok(text.includes(compact("Group Policy No. G-TLI-26-136 (herein")));
  });

  // Configured but unreadable fails the certificate rather than issuing it
  // unsigned — tryBuildCertificate is what keeps that from costing the email.
  test("fails when the configured signature cannot be read", async () => {
    config.certificateSignaturePath = join(tmpdir(), "no-such-signature-8f2c.png");
    const { pool } = poolFor();

    await assert.rejects(() => buildCertificate(pool, 96), /CERTIFICATE_SIGNATURE_PATH/);
  });

  test("draws the configured signature", async () => {
    const dir = mkdtempSync(join(tmpdir(), "coc-"));
    const path = join(dir, "signature.png");
    writeFileSync(
      path,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        "base64",
      ),
    );
    config.certificateSignaturePath = path;
    const { pool } = poolFor();

    const attachment = await buildCertificate(pool, 96);

    assert.match(attachment.content.toString("latin1"), /\/Subtype \/Image/);
  });
});

describe("certificateService — resendCertificate, HR's button", () => {
  // Graph is reached through the global fetch, as in emailService.test.js. A
  // token that expires at once keeps the module's token cache from carrying
  // anything between tests.
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const stubGraph = ({ sendOk = true } = {}) => {
    const sends = [];

    globalThis.fetch = async (url, options) => {
      if (/login\.microsoftonline\.com/.test(String(url)))
        return { ok: true, status: 200, json: async () => ({ access_token: "tok", expires_in: 0 }) };

      sends.push(JSON.parse(options.body));
      return sendOk
        ? { ok: true, status: 202, text: async () => "" }
        : { ok: false, status: 503, text: async () => "unavailable", headers: { get: () => null } };
    };

    return sends;
  };

  const quietly = async (fn) => {
    const restore = console.error;
    console.error = () => {};
    try {
      return await fn();
    } finally {
      console.error = restore;
    }
  };

  test("mails the certificate to the address on the enrollment record", async () => {
    const sends = stubGraph();
    const { pool } = poolFor();

    const result = await resendCertificate(pool, 96);

    assert.deepEqual(result, { to: "lorenz@coforge.com" });
    assert.equal(sends.length, 1);

    const { message } = sends[0];
    assert.equal(message.toRecipients[0].emailAddress.address, "lorenz@coforge.com");
    assert.equal(message.attachments[0].name, "G-TLI-26-136-2600030-Lorenz-Artillagas.pdf");
    assert.equal(
      Buffer.from(message.attachments[0].contentBytes, "base64").subarray(0, 5).toString(),
      "%PDF-",
    );
  });

  // A certificate resent months later must not read as a second set of
  // credentials — no password, no username, its own subject.
  test("sends the certificate on its own, with nothing about credentials", async () => {
    const sends = stubGraph();
    const { pool } = poolFor();

    await resendCertificate(pool, 96);

    const { message } = sends[0];
    assert.equal(message.subject, "Your Certificate of Coverage");
    assert.match(message.body.content, /G-TLI-26-136-2600030/);
    assert.doesNotMatch(message.body.content, /Username|Password:/);
  });

  // HR pressed the button and has to know. A plain Graph error would reach
  // errorHandler as "Server Error", which says nothing about what the employee
  // received.
  test("answers 502, saying nothing was sent, when the email fails", async () => {
    stubGraph({ sendOk: false });
    const { pool } = poolFor();

    await quietly(() =>
      assert.rejects(
        () => resendCertificate(pool, 96),
        (error) => error.statusCode === 502 && /nothing was sent/.test(error.message),
      ),
    );
  });

  test("refuses before building anything when there is no address to send to", async () => {
    const sends = stubGraph();
    const { pool } = poolFor({ details: [enrollmentRow({ email_address: null })] });

    await assert.rejects(
      () => resendCertificate(pool, 96),
      (error) => error.statusCode === 409 && /no email address/.test(error.message),
    );
    assert.equal(sends.length, 0);
  });

  // The refusals from buildCertificateData reach HR as they are — a
  // certificate that cannot be issued is not mailed half-made.
  test("mails nothing for an enrollment that cannot be certified", async () => {
    const sends = stubGraph();
    const { pool } = poolFor({ benefits: [] });

    await assert.rejects(
      () => resendCertificate(pool, 96),
      (error) => error.statusCode === 409,
    );
    assert.equal(sends.length, 0);
  });

  test("mails nothing for a client with no enrollment", async () => {
    const sends = stubGraph();
    const { pool } = poolFor({ details: [] });

    await assert.rejects(
      () => resendCertificate(pool, 96),
      (error) => error.statusCode === 404,
    );
    assert.equal(sends.length, 0);
  });
});

describe("certificateService — certificateForDecision, after a change request", () => {
  // An approval can change the name, address and beneficiaries, all of which
  // the certificate prints. The employee's copy is stale the moment it commits.
  test("an approval carries a fresh certificate", async () => {
    const { pool, calls } = poolFor();

    const attachment = await certificateForDecision(pool, 96, true);

    assert.equal(attachment.name, "G-TLI-26-136-2600030-Lorenz-Artillagas.pdf");
    assert.equal(inputsFor(calls, DETAILS).client_id, 96);
  });

  // Nothing changed, so nothing is attached — and nothing is read. A rejection
  // should not cost three procedure calls and a PDF nobody receives.
  test("a rejection carries none, and reads nothing to decide that", async () => {
    const { pool, calls } = poolFor();

    assert.equal(await certificateForDecision(pool, 96, false), null);
    assert.equal(calls.length, 0);
  });

  // The decision email is the only thing that tells the employee what HR
  // decided. A certificate that cannot be built must not take it down.
  test("an approval whose certificate cannot be built resolves to null, not a rejection", async () => {
    const { pool } = poolFor({ benefits: [] });
    const restore = console.error;
    console.error = () => {};

    try {
      assert.equal(await certificateForDecision(pool, 96, true), null);
    } finally {
      console.error = restore;
    }
  });
});

describe("certificateService — tryBuildCertificate, for the senders that must go out", () => {
  // The confirmation email carries the only copy of the temporary password.
  // If this rejected, enrollmentService would skip that email and the employee
  // would hold an account nobody can tell them how to open.
  test("resolves to null instead of rejecting when the certificate cannot be built", async () => {
    const { pool } = poolFor({ benefits: [] });
    const restore = console.error;
    console.error = () => {};

    try {
      assert.equal(await tryBuildCertificate(pool, 96), null);
    } finally {
      console.error = restore;
    }
  });

  test("says in the log which client went without one", async () => {
    const { pool } = poolFor({ details: [] });
    const logged = [];
    const restore = console.error;
    console.error = (...args) => logged.push(args.join(" "));

    try {
      await tryBuildCertificate(pool, 96);
    } finally {
      console.error = restore;
    }

    assert.match(logged[0], /client 96/);
  });

  test("resolves to the attachment when it can", async () => {
    const { pool } = poolFor();

    const attachment = await tryBuildCertificate(pool, 96);

    assert.equal(attachment.name, "G-TLI-26-136-2600030-Lorenz-Artillagas.pdf");
  });
});

describe("certificateService — the filename", () => {
  const name = (firstName, lastName, policyNo = "G-TLI-26-137-2600016") =>
    certificateFileName({ policyNo, firstName, lastName });

  test("is the business's example exactly", () => {
    assert.equal(name("Juan", "Dela Cruz"), "G-TLI-26-137-2600016-Juan-Dela-Cruz.pdf");
  });

  test("leaves the suffix out, like the middle name", async () => {
    const { pool } = poolFor({ details: [enrollmentRow({ suffix: "Jr." })] });

    const attachment = await buildCertificate(pool, 96);

    assert.equal(attachment.name, "G-TLI-26-136-2600030-Lorenz-Artillagas.pdf");
  });

  test("takes accents off, and drops periods and apostrophes", () => {
    assert.equal(name("Ma. Luisa", "Peña"), "G-TLI-26-137-2600016-Ma-Luisa-Pena.pdf");
    assert.equal(name("José", "O'Neil"), "G-TLI-26-137-2600016-Jose-ONeil.pdf");
    assert.equal(name("Jose", "O’Neil"), "G-TLI-26-137-2600016-Jose-ONeil.pdf");
  });

  // The same ñ can arrive as one character or as n plus a combining tilde.
  test("treats a decomposed ñ the same as a composed one", () => {
    assert.equal(name("Juan", "Pen\u0303a"), "G-TLI-26-137-2600016-Juan-Pena.pdf");
  });

  test("keeps the case as stored", () => {
    assert.equal(name("JUAN", "DELA CRUZ"), "G-TLI-26-137-2600016-JUAN-DELA-CRUZ.pdf");
  });

  test("collapses runs of spaces and hyphens, and trims the ends", () => {
    assert.equal(name(" Anne-Marie ", "Dela  Cruz"), "G-TLI-26-137-2600016-Anne-Marie-Dela-Cruz.pdf");
    assert.equal(name("Anne - Marie", "Cruz"), "G-TLI-26-137-2600016-Anne-Marie-Cruz.pdf");
  });

  // The policy number alone keeps the file unique, so a name with nothing
  // ASCII in it leaves no dangling hyphens behind.
  test("is the policy number alone when the name reduces to nothing", () => {
    assert.equal(name("李", "王"), "G-TLI-26-137-2600016.pdf");
    assert.equal(name(null, undefined), "G-TLI-26-137-2600016.pdf");
  });
});
