import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import ExcelJS from "exceljs";

const require = createRequire(import.meta.url);

// These pin a dependency decision rather than any of our own logic, which is why
// they sit apart from the rest of the suite.
//
// The Excel report is the one feature built entirely on a third-party library,
// and it has no other test — buildEnrollmentReport calls getPool() internally,
// so there is nowhere to inject a fake pool. What can be proven without a
// database is that the library still produces a file, and that is what this does.
describe("the Excel export's dependencies", () => {
  // Every feature here is one exportService.js actually uses. A workbook that
  // writes but cannot be read back is not a passing result, so it round-trips.
  test("the workbook the export builds still writes and reads back", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Enrollments", {
      views: [{ state: "frozen", ySplit: 4 }],
    });

    sheet.columns = [
      { key: "company", width: 30 },
      { key: "employeeNo", width: 16 },
      { key: "coverage", width: 12 },
    ];

    sheet.mergeCells(1, 1, 1, 3);
    const title = sheet.getCell(1, 1);
    title.value = "Beneficiary Enrollment Report";
    title.fill = {
      type: "gradient",
      gradient: "angle",
      degree: 0,
      stops: [
        { position: 0, color: { argb: "FF2C3B7D" } },
        { position: 1, color: { argb: "FF409965" } },
      ],
    };

    sheet.getRow(4).values = ["Company", "Employee No.", "Coverage"];
    sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: 3 } };

    const row = sheet.addRow({ company: "HCL", employeeNo: "EMP-020", coverage: 100 });
    row.getCell("coverage").numFmt = '0.00"%"';

    sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1 };
    sheet.pageSetup.printTitlesRow = "4:4";

    const buffer = await workbook.xlsx.writeBuffer();

    assert.equal(Buffer.from(buffer).subarray(0, 2).toString(), "PK", "not a zip archive");

    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(buffer);
    const read = reopened.getWorksheet("Enrollments");

    assert.equal(read.getCell(1, 1).value, "Beneficiary Enrollment Report");
    assert.equal(read.getCell(5, 2).value, "EMP-020");
    assert.equal(read.getCell(5, 3).numFmt, '0.00"%"');
  });

  // exceljs depends on uuid ^8.3.2, and every uuid below 11.1.1 carries
  // GHSA-w5hq-g745-h8pq. There is no fixed exceljs — 4.4.0 is the latest
  // published version — so `npm audit fix --force` "fixes" it by installing
  // exceljs@3.4.0, a two-major DOWNGRADE of the library this whole report is
  // built on. That is the trap this test exists to spring.
  //
  // The advisory does not reach us either way: exceljs calls uuid in exactly one
  // file, cf-ext/cf-rule-ext-xform.js, and only v4() with no `buf` argument,
  // while the advisory needs v3/v5/v6 with one. The override is for a clean
  // audit, not for a reachable bug.
  test("exceljs stays on 4.x — `npm audit fix --force` downgrades it to 3.4.0", () => {
    const { version } = require("exceljs/package.json");
    const major = Number(version.split(".")[0]);

    assert.ok(
      major >= 4,
      `exceljs is ${version}. Anything below 4 is the --force downgrade, not a fix`,
    );
  });

  // package.json carries `overrides: { "uuid": "^11.1.1" }`. Verified when it was
  // added: exceljs destructures v4 from a CJS require, which uuid 11 still
  // supports, and a workbook writes and round-trips under it.
  //
  // Removing the override drops uuid back to 8.3.2 and `npm audit` stops reading
  // clean, which is the state this branch existed to end.
  test("uuid is held at the overridden 11.x, which is what keeps the audit clean", () => {
    const { version } = require("uuid/package.json");
    const [major, minor, patch] = version.split(".").map(Number);

    assert.ok(
      major > 11 || (major === 11 && (minor > 1 || (minor === 1 && patch >= 1))),
      `uuid is ${version}. Below 11.1.1 the audit reports GHSA-w5hq-g745-h8pq again`,
    );
  });
});
