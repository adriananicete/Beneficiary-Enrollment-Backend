import { describe, test } from "node:test";
import assert from "node:assert/strict";

import ExcelJS from "exceljs";
import {
  CODES_SHEET,
  INVITATIONS_SHEET,
  buildInvitationTemplate,
  invitationTemplateFileName,
} from "../../src/utils/invitationTemplate.js";
import { MAX_INVITATION_EMAILS } from "../../src/utils/partitionInvitations.js";

// HR's invitation file, branch 6. Written and read back, so what is asserted
// is what Excel will open, not the object before it was saved. Whether Excel
// itself shows the dropdowns is the manual run's first step.

const ABCC = {
  company: { employer_id: "5", company_code: "ABCC", company_name: "Abacus Book and Card Corporation" },
  classes: [
    { classification_id: "51", classification_code: "CLASS 1", classification_desc: "Officers" },
    { classification_id: "54", classification_code: "CLASS 4", classification_desc: "Rank and file" },
  ],
  affiliates: [
    { affiliate_id: "7", affiliate_code: "ALAKOR", affiliate_name: "Alakor Corporation" },
    { affiliate_id: "8", affiliate_code: "ANVIL", affiliate_name: "Anvil Publishing, Inc." },
  ],
};

const COFORGE = {
  company: { employer_id: "1", company_code: "Coforge", company_name: "Coforge BPS Philippines, Inc." },
  classes: [{ classification_id: "1", classification_code: "VP", classification_desc: "Vice President" }],
  affiliates: [],
};

const reopen = async (codes) => {
  const buffer = await buildInvitationTemplate(codes).xlsx.writeBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  return {
    sheet: workbook.getWorksheet(INVITATIONS_SHEET),
    codes: workbook.getWorksheet(CODES_SHEET),
    names: workbook.worksheets.map((w) => w.name),
  };
};

const valuesOf = (sheet, columns, rows) =>
  rows.map((r) => columns.map((c) => sheet.getCell(`${c}${r}`).value ?? null));

const LAST_ROW = MAX_INVITATION_EMAILS + 1;

describe("the invitation template — a company with affiliates", () => {
  test("has the two sheets, the one to fill first", async () => {
    const { names } = await reopen(ABCC);

    assert.deepEqual(names, [INVITATIONS_SHEET, CODES_SHEET]);
  });

  test("the sheet to fill has Email, Classification and Affiliate, and no rows", async () => {
    const { sheet } = await reopen(ABCC);

    assert.deepEqual(valuesOf(sheet, ["A", "B", "C", "D"], [1]), [["Email", "Classification", "Affiliate", null]]);
    assert.equal(sheet.getCell("A2").value ?? null, null);
  });

  // The codes sheet lists exactly the active classes, then the company itself
  // and its active affiliates: the company first, as the first choice.
  test("the codes sheet lists the classes, then the company and its affiliates", async () => {
    const { codes } = await reopen(ABCC);

    assert.deepEqual(valuesOf(codes, ["A", "B"], [1, 2, 3, 4]), [
      ["Classification", "Description"],
      ["CLASS 1", "Officers"],
      ["CLASS 4", "Rank and file"],
      [null, null],
    ]);
    assert.deepEqual(valuesOf(codes, ["D", "E"], [1, 2, 3, 4, 5]), [
      ["Affiliate", "Name"],
      ["ABCC", "Abacus Book and Card Corporation"],
      ["ALAKOR", "Alakor Corporation"],
      ["ANVIL", "Anvil Publishing, Inc."],
      [null, null],
    ]);
  });

  test("both code columns carry a dropdown of their codes, down to the last row an upload may have", async () => {
    const { sheet } = await reopen(ABCC);

    for (const row of [2, 500, LAST_ROW]) {
      assert.equal(sheet.getCell(`B${row}`).dataValidation?.type, "list", `B${row}`);
      assert.deepEqual(sheet.getCell(`B${row}`).dataValidation.formulae, [`${CODES_SHEET}!$A$2:$A$3`], `B${row}`);
      assert.deepEqual(sheet.getCell(`C${row}`).dataValidation?.formulae, [`${CODES_SHEET}!$D$2:$D$4`], `C${row}`);
    }

    // Not the header, and not past the limit.
    assert.equal(sheet.getCell("B1").dataValidation, undefined);
    assert.equal(sheet.getCell(`B${LAST_ROW + 1}`).dataValidation, undefined);
    // Not the email column.
    assert.equal(sheet.getCell("A2").dataValidation, undefined);
  });

  // Text, so Excel keeps a code like "1" as typed rather than as a number.
  test("the columns to fill are text", async () => {
    const { sheet } = await reopen(ABCC);

    for (const column of ["A", "B", "C"]) assert.equal(sheet.getColumn(column).numFmt, "@", column);
  });
});

describe("the invitation template — a company without affiliates", () => {
  test("has no Affiliate column and no affiliate codes", async () => {
    const { sheet, codes } = await reopen(COFORGE);

    assert.deepEqual(valuesOf(sheet, ["A", "B", "C"], [1]), [["Email", "Classification", null]]);
    assert.equal(sheet.getCell("C2").dataValidation, undefined);
    assert.deepEqual(valuesOf(codes, ["D", "E"], [1, 2]), [[null, null], [null, null]]);
  });

  test("still has the class dropdown", async () => {
    const { sheet } = await reopen(COFORGE);

    assert.deepEqual(sheet.getCell("B2").dataValidation?.formulae, [`${CODES_SHEET}!$A$2:$A$2`]);
  });
});

// An empty list is not a range Excel accepts.
test("a company with no active class gets no class dropdown", async () => {
  const { sheet } = await reopen({ ...COFORGE, classes: [] });

  assert.equal(sheet.getCell("B2").dataValidation, undefined);
});

describe("invitationTemplateFileName", () => {
  test("is invitations-<company code>.xlsx", () => {
    assert.equal(invitationTemplateFileName(ABCC.company), "invitations-ABCC.xlsx");
    assert.equal(invitationTemplateFileName({ company_code: "NBS-2" }), "invitations-NBS-2.xlsx");
  });

  // A code made before branch 2's rule cannot break the header.
  test("replaces anything that is not a letter, a digit or a hyphen", () => {
    assert.equal(invitationTemplateFileName({ company_code: 'A "B"\\C' }), "invitations-A__B__C.xlsx");
  });
});
