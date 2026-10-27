import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";

import { renderCertificate, SIGNATORY } from "../../src/utils/certificatePdf.js";
import {
  pdfRuns,
  pdfText,
  compact,
  pageCount,
  contentStream,
  imagePaints,
  textBlocks,
} from "../helpers/pdfRuns.js";

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

const round = (value) => Math.round(value * 100) / 100;

// The mark sits in the band the title and the policy number occupy and clear of
// both horizontally, so the fixture is unchanged and still compared whole. It
// was regenerated at no point: a golden file taken from the code under test
// asserts that the code does what it does, which is the trap in CLAUDE.md §11.
const policyNumberRun = EXAMPLE_RUNS.find(
  (run) => run.text !== undefined && run.text.startsWith("No.   "),
);

// pdfRuns reads text, rectangles and lines and not images, so images are read
// by imagePaints, which follows the transformation in force at each paint.
//
// That is needed since the watermark. It paints the same image as the mark,
// thirty-six times, each under a rotation written in `cm` operators before the
// image's own matrix. This file used to match only that own matrix, and it
// would have gone on passing by accident: a tile's own matrix carries a
// negative x, which the pattern here happened not to match.
//
// Upright paints are the mark and the signature. Tilted ones are the watermark.
const uprightImages = (pdf) => imagePaints(pdf).filter((paint) => paint.angle === 0);
const watermarkTiles = (pdf) => imagePaints(pdf).filter((paint) => paint.angle !== 0);

const imagePlacements = (pdf) =>
  uprightImages(pdf).map(({ x, top, width, height }) => ({ x, top, width, height }));

// Counted from the paints, not from `/Subtype /Image`. A PNG carrying an alpha
// channel is embedded as two image objects — the picture and an SMask for the
// transparency — so counting the objects reports two per image and four for a
// certificate with a mark and a signature.
const imageCount = (pdf) => imagePlacements(pdf).length;

const PAGE = { width: 612, height: 792 };

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

  // The mark, flush with the left margin and on the top one, 30 points tall.
  //
  // Be clear about what this proves and what it cannot. It proves PDFKit was
  // asked to put the image at that place and that size. It says nothing about
  // whether the asset behind it is the right image, is the right way up, or
  // carries transparent padding that pushes the visible mark off the margin —
  // which is not hypothetical: it was the state of this branch until the
  // placement was read out of the content stream and the width came back 92.78
  // instead of 70.3. Only opening the PDF catches the rest.
  test("draws the mark flush on the top left, 30 points tall", async () => {
    const [mark, ...rest] = imagePlacements(await renderCertificate(EXAMPLE));

    assert.deepEqual(rest, []);
    assert.deepEqual(mark, { x: 48, top: 40, width: 70.31, height: 30 });
  });

  // The width is the asset's own, not a number chosen here — PDFKit is given
  // only a height. So this fails if the file is replaced by one of different
  // proportions, and that is the point: the mark shares its band with the
  // centred title from x 202 and the policy number from x 460, and a wider
  // replacement would run into them with nothing else to say so.
  test("the mark stays clear of the title and the policy number beside it", async () => {
    const [mark] = imagePlacements(await renderCertificate(EXAMPLE));
    const title = EXAMPLE_RUNS.find((run) => run.size === 13);

    assert.equal(round(mark.width / mark.height), 2.34);

    for (const neighbour of [title, policyNumberRun])
      assert.ok(
        mark.x + mark.width < neighbour.x,
        `the mark runs to ${mark.x + mark.width}, into "${neighbour.text}" at ${neighbour.x}`,
      );
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

  // The slot above the name. Absent, nothing is drawn there and the name sits
  // where the example has it; present, the image goes in and the name does not
  // move.
  //
  // Counted rather than matched, because the mark in the header is an image
  // too. `doesNotMatch(/\/Subtype \/Image/)` was the assertion here until the
  // logo landed, and it would now pass for a certificate carrying the mark and
  // no signature, or the mark and two. Upright images only: the watermark
  // tiles are tilted, and are counted in their own tests below.
  test("draws one upright image, the mark, when there is no signature", async () => {
    assert.equal(imageCount(await renderCertificate(EXAMPLE)), 1);
  });

  test("draws the signature above the name without moving the name", async () => {
    const withSignature = await renderCertificate({ ...EXAMPLE, signatureImage: PNG });

    assert.equal(imageCount(withSignature), 2);
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

// The faint, tilted mark repeated over the whole page, asked for 2026-09-23.
//
// What these cannot say is how it looks — whether 7% is too faint or too loud
// on a real screen and a real printer. That was judged by rendering the page
// and looking at it, and it is the business's call, not a test's.
//
// What they do pin is everything that would be expensive to get wrong quietly.
// The worst of those is the opacity leaking past the watermark: every word on
// the certificate would print at 7% and still pass every text assertion above.
describe("renderCertificate — the watermark", () => {
  test("tiles the mark over the page, tilted as Ant Design tilts it, and faint", async () => {
    const pdf = await renderCertificate(EXAMPLE);
    const [mark] = uprightImages(pdf);
    const tiles = watermarkTiles(pdf);

    assert.equal(tiles.length, 36);

    for (const tile of tiles) {
      assert.equal(tile.image, mark.image, "a tile paints something other than the mark");
      assert.equal(tile.angle, -22);
      assert.equal(tile.width, 90);
      assert.equal(tile.height, 38.4);
      assert.equal(tile.opacity, 0.07);
    }
  });

  test("embeds the mark once, however many tiles paint it", async () => {
    // Two objects, not thirty-seven: the picture and the SMask carrying its
    // transparency. Each tile is a few bytes of drawing commands.
    const pdf = await renderCertificate(EXAMPLE);

    assert.equal((pdf.toString("latin1").match(/\/Subtype \/Image/g) ?? []).length, 2);
  });

  test("leaves every word, and the mark, at full strength", async () => {
    const pdf = await renderCertificate(EXAMPLE);

    assert.deepEqual(new Set(textBlocks(pdf).map((block) => block.opacity)), new Set([1]));
    assert.equal(uprightImages(pdf)[0].opacity, 1);
  });

  test("is drawn first, so the whole certificate sits on top of it", async () => {
    // A PDF paints in order. Anything drawn before the watermark would be
    // underneath it.
    const pdf = await renderCertificate(EXAMPLE);
    const lastTile = Math.max(...watermarkTiles(pdf).map((tile) => tile.at));

    assert.ok(lastTile < uprightImages(pdf)[0].at, "the mark is drawn under the watermark");
    assert.ok(lastTile < textBlocks(pdf)[0].at, "text is drawn under the watermark");
    assert.ok(lastTile < contentStream(pdf).search(/ re\r?\n/), "a table is drawn under the watermark");
  });

  test("draws nothing off the page, and leaves no edge bare", async () => {
    const tiles = watermarkTiles(await renderCertificate(EXAMPLE));

    for (const tile of tiles)
      assert.ok(
        tile.right > 0 && tile.x < PAGE.width && tile.bottom > 0 && tile.top < PAGE.height,
        `a tile at ${tile.x}, ${tile.top} lies wholly off the page`,
      );

    // The pattern leaves 29.08 points between one row and the next, so a bare
    // strip at the top or bottom no wider than that reads as part of it. The
    // sides are covered past the edge.
    assert.ok(Math.min(...tiles.map((tile) => tile.top)) < 29.08);
    assert.ok(Math.max(...tiles.map((tile) => tile.bottom)) > PAGE.height - 29.08);
    assert.ok(Math.min(...tiles.map((tile) => tile.x)) <= 0);
    assert.ok(Math.max(...tiles.map((tile) => tile.right)) >= PAGE.width);
  });

  test("is on the tallest certificate too, which still fits one page", async () => {
    // The ten-dependent test above guards the page count. This guards that the
    // watermark is not what got dropped to make it fit.
    const pdf = await renderCertificate({
      ...EXAMPLE,
      dependents: Array.from({ length: 10 }, (_, i) => dependent(i + 1)),
    });

    assert.equal(pageCount(pdf), 1);
    assert.equal(watermarkTiles(pdf).length, 36);
  });
});
