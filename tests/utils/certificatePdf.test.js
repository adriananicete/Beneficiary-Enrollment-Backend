import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";

import { renderCertificate, SIGNATORY } from "../../src/utils/certificatePdf.js";
import { pdfRuns, pdfText, compact, pageCount } from "../helpers/pdfRuns.js";

// The layout, tested without a database. certificateService does the reading
// and formatting; this file only proves that what it is handed lands on the
// page where the approved format puts it.
//
// The fixture is read out of md/Certificate-of-Coverage-74.pdf — the example
// the business supplied — and NOT out of this renderer's own output. A golden
// file generated from the code under test would pin whatever the code happened
// to do. This one pins what was asked for: 109 text runs, rectangles and lines,
// each with its position, face and size, and every justified line breaking on
// the same word.
const EXAMPLE_RUNS = JSON.parse(
  readFileSync(new URL("../fixtures/certificate-example-runs.json", import.meta.url), "utf8"),
);

// Enrollment 74 as the example prints it — including two things this system
// deliberately does differently, so the layout can be compared like with like:
// the example prints the employee's policy number as the Group Policy No. too,
// and writes the Terminal Illness formula in lower case. Both values are the
// service's business, and certificateService.test.js asserts the right ones.
const EXAMPLE = {
  policyNo: "G-TLI-26-136-2600030",
  groupPolicyNo: "G-TLI-26-136-2600030",
  companyName: "Coforge BPS Philippines, Inc.",
  insuredName: "Lorenz Adrian Artillagas",
  address: "Celina Homes 5, Tagapo, City Of Santa Rosa, Laguna, Region IV-A (CALABARZON), 4026",
  coverageDate: "September 11, 2026",
  premium: "—",
  coverages: [
    { label: "Group Term Life Insurance Plan (GTLIP)", amount: "P 500,000" },
    { label: "Group Total and Permanent Disability Rider (GTPDR)", amount: "P 500,000" },
    { label: "GTLI – Additional Life", amount: "P 55,000" },
    { label: "Group Terminal Illness Rider (GTIR)", amount: "50% of GTLIP" },
  ],
  dependentColumns: ["GTLIP", "GTPDR", "GTLI – Additional Life"],
  dependents: [
    { name: "Christine Fadul", relationship: "Spouse", amounts: ["500,000", "500,000", "55,000"] },
  ],
  signatureImage: null,
};

// The smallest valid PNG: one transparent pixel.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

const dependent = (i) => ({
  name: `Beneficiary Number ${i}`,
  relationship: "Child",
  amounts: ["50,000", "50,000", "5,500"],
});

const nameRun = (runs) => runs.find((run) => run.text && compact(run.text) === compact(SIGNATORY.name));

describe("renderCertificate — the approved format", () => {
  test("produces a PDF", async () => {
    const pdf = await renderCertificate(EXAMPLE);

    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    assert.equal(pageCount(pdf), 1);
  });

  // The whole page at once. If this fails, print both lists: the first
  // differing entry names the element that moved and by how much.
  test("draws the example's data exactly where the example draws it", async () => {
    const runs = pdfRuns(await renderCertificate(EXAMPLE));

    assert.deepEqual(runs, EXAMPLE_RUNS);
  });

  test("embeds Liberation Sans Narrow, all four faces", async () => {
    const pdf = (await renderCertificate(EXAMPLE)).toString("latin1");

    // The regular face's PostScript name carries no suffix, as Arial Narrow's
    // does not in the example.
    for (const name of ["", "-Bold", "-Italic", "-BoldItalic"])
      assert.match(pdf, new RegExp(`/BaseFont /\\w+\\+LiberationSansNarrow${name}\\s`));
  });
});

describe("renderCertificate — what the example does not show", () => {
  // Beneficiaries are capped at ten by validateCoverage. Ten, with an address
  // long enough to wrap, is the tallest certificate this system can produce,
  // and it has to stay one page: a second page holding the tail of the legal
  // text would read as a different document.
  test("ten dependents and a two-line address still fit on one page", async () => {
    const pdf = await renderCertificate({
      ...EXAMPLE,
      address: `${"Block 12 Lot 34, Phase 5, Some Very Long Subdivision Name, ".repeat(3)}${EXAMPLE.address}`,
      dependents: Array.from({ length: 10 }, (_, i) => dependent(i + 1)),
    });

    assert.equal(pageCount(pdf), 1);
    assert.ok(pdfText(pdf).includes(compact("GTLP2012v01")), "the footer was pushed off the page");
  });

  test("the dependents table grows by one fifteen-point row per dependent", async () => {
    const runs = pdfRuns(
      await renderCertificate({ ...EXAMPLE, dependents: [1, 2, 3].map(dependent) }),
    );

    // The last full-width rectangle on the page is the dependents table: 18 of
    // header, then 15 a row.
    const dependentsTable = runs.filter((run) => run.rect && run.rect[2] === 516).at(-1);
    assert.equal(dependentsTable.rect[3], 18 + 15 * 3);
  });

  test("prints every dependent's name", async () => {
    const pdf = await renderCertificate({ ...EXAMPLE, dependents: [1, 2, 3].map(dependent) });

    for (const i of [1, 2, 3])
      assert.ok(pdfText(pdf).includes(compact(`Beneficiary Number ${i}`)));
  });

  // The slot above the name. Absent, nothing is drawn and the name sits where
  // the example has it; present, the image goes in and the name does not move.
  test("draws no image when there is no signature", async () => {
    const pdf = (await renderCertificate(EXAMPLE)).toString("latin1");

    assert.doesNotMatch(pdf, /\/Subtype \/Image/);
  });

  test("draws the signature above the name without moving the name", async () => {
    const withSignature = await renderCertificate({ ...EXAMPLE, signatureImage: PNG });

    assert.match(withSignature.toString("latin1"), /\/Subtype \/Image/);
    assert.deepEqual(nameRun(pdfRuns(withSignature)), nameRun(EXAMPLE_RUNS));
  });

  // PDFKit reads PNG and JPEG and nothing else. A GIF or a WebP dropped in as
  // the signature must fail the certificate loudly rather than produce one.
  test("rejects a signature it cannot read", async () => {
    await assert.rejects(() =>
      renderCertificate({ ...EXAMPLE, signatureImage: Buffer.from("GIF89a not really") }),
    );
  });
});
