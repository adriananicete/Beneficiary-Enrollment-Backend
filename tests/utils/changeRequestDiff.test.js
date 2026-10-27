import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  same,
  buildBeneficiaryChanges,
  assertAddressBelongs,
  buildAddressChange,
} from "../../src/utils/changeRequestDiff.js";

// This is the translation between what the employee submits — the full intended
// state — and the actions the stored procedure wants. It decides what HR sees on
// the review screen, and it had no assertions at all until it was lifted out of
// changeRequestController, where it was module-private.

const current = (overrides = {}) => ({
  // BigInt columns come back from mssql as strings. The submitted payload
  // carries numbers. Every comparison here crosses that line.
  beneficiary_id: "5",
  full_name: "Juan Reyes",
  relationship: "Child",
  age: 9,
  coverage_percent: 100,
  ...overrides,
});

describe("same — the comparison everything else is built on", () => {
  test("a number and its string are the same value", () => {
    assert.equal(same(50, "50"), true);
    assert.equal(same("100", 100), true);
  });

  // A cleared optional field arrives as one and is stored as the other.
  // Treating them as different would report a change on every submit.
  test("null, undefined and empty string are all absent", () => {
    assert.equal(same(null, ""), true);
    assert.equal(same(undefined, ""), true);
    assert.equal(same(null, undefined), true);
  });

  test("surrounding whitespace is not a change", () => {
    assert.equal(same("  Juan Reyes  ", "Juan Reyes"), true);
  });

  test("a real difference is still a difference", () => {
    assert.equal(same("Juan Reyes", "Juan Reyes Jr."), false);
    assert.equal(same(9, 10), false);
    assert.equal(same("", "0"), false);
  });
});

describe("buildBeneficiaryChanges", () => {
  // The headline case. Sending a U row for every existing beneficiary would
  // work as far as the database is concerned, and would make the review screen
  // useless: HR would see every beneficiary marked as changed when the employee
  // corrected one name.
  test("an unchanged list produces no rows at all", () => {
    const changes = buildBeneficiaryChanges(
      [
        { beneficiary_id: 5, full_name: "Juan Reyes", relationship: "Child", age: 9, coverage_percent: 100 },
      ],
      [current()],
      11,
    );

    assert.deepEqual(changes, []);
  });

  test("only the edited beneficiary becomes a U row", () => {
    const changes = buildBeneficiaryChanges(
      [
        { beneficiary_id: 5, full_name: "Juan Reyes Jr.", relationship: "Child", age: 9, coverage_percent: 50 },
        { beneficiary_id: 6, full_name: "Maria Reyes", relationship: "Child", age: 7, coverage_percent: 50 },
      ],
      [
        current({ beneficiary_id: "5", coverage_percent: 50 }),
        current({ beneficiary_id: "6", full_name: "Maria Reyes", age: 7, coverage_percent: 50 }),
      ],
      11,
    );

    assert.equal(changes.length, 1);
    assert.equal(changes[0].action, "U");
    assert.equal(changes[0].beneficiaryId, 5);
    assert.equal(changes[0].fullName, "Juan Reyes Jr.");
  });

  // Every field is compared, so a change in any one of them has to produce the
  // row. A comparison that quietly only looked at the name would pass the test
  // above and lose the other three.
  for (const [field, value] of [
    ["full_name", "Juan Reyes Jr."],
    ["relationship", "Spouse"],
    ["age", 10],
    ["coverage_percent", 60],
  ]) {
    test(`a changed ${field} produces the U row`, () => {
      const submitted = {
        beneficiary_id: 5,
        full_name: "Juan Reyes",
        relationship: "Child",
        age: 9,
        coverage_percent: 100,
        [field]: value,
      };

      const changes = buildBeneficiaryChanges([submitted], [current()], 11);

      assert.equal(changes.length, 1, `a changed ${field} was not noticed`);
      assert.equal(changes[0].action, "U");
    });
  }

  test("a beneficiary with no id is an insert, with a null id", () => {
    const changes = buildBeneficiaryChanges(
      [
        { beneficiary_id: 5, full_name: "Juan Reyes", relationship: "Child", age: 9, coverage_percent: 50 },
        { full_name: "Baby Reyes", relationship: "Child", age: 1, coverage_percent: 50 },
      ],
      [current({ coverage_percent: 50 })],
      11,
    );

    assert.equal(changes.length, 1);
    assert.equal(changes[0].action, "I");
    assert.equal(changes[0].beneficiaryId, null);
    assert.equal(changes[0].fullName, "Baby Reyes");
  });

  test("a beneficiary left out of the payload is a delete", () => {
    const changes = buildBeneficiaryChanges(
      [{ beneficiary_id: 5, full_name: "Juan Reyes", relationship: "Child", age: 9, coverage_percent: 100 }],
      [current(), current({ beneficiary_id: "6", full_name: "Maria Reyes" })],
      11,
    );

    assert.equal(changes.length, 1);
    assert.equal(changes[0].action, "D");
    assert.equal(changes[0].beneficiaryId, 6);
    // A delete carries no values — the row identifies what to remove.
    assert.equal(changes[0].fullName, null);
  });

  test("deletes come first, then updates, then inserts", () => {
    const changes = buildBeneficiaryChanges(
      [
        { beneficiary_id: 5, full_name: "Juan Reyes Jr.", relationship: "Child", age: 9, coverage_percent: 50 },
        { full_name: "Baby Reyes", relationship: "Child", age: 1, coverage_percent: 50 },
      ],
      [current(), current({ beneficiary_id: "6", full_name: "Maria Reyes" })],
      11,
    );

    assert.deepEqual(changes.map((row) => row.action), ["D", "U", "I"]);
  });

  // mssql hands BigInt columns back as strings, so the stored id is "5" and the
  // submitted one is 5. Comparing them without coercion would read every edit
  // as an id that does not belong to this enrollment and answer 403.
  test("a numeric submitted id matches the string the database returned", () => {
    const changes = buildBeneficiaryChanges(
      [{ beneficiary_id: 5, full_name: "Juan Reyes Jr.", relationship: "Child", age: 9, coverage_percent: 100 }],
      [current({ beneficiary_id: "5" })],
      11,
    );

    assert.equal(changes.length, 1);
    assert.equal(changes[0].action, "U");
  });

  test("refuses an id that is not on this enrollment", () => {
    assert.throws(
      () =>
        buildBeneficiaryChanges(
          [{ beneficiary_id: 999, full_name: "Someone Else", relationship: "Child", age: 9, coverage_percent: 100 }],
          [current()],
          11,
        ),
      (error) => error.statusCode === 403 && /does not belong to this enrollment/.test(error.message),
    );
  });

  test("refuses the same beneficiary twice in one request", () => {
    assert.throws(
      () =>
        buildBeneficiaryChanges(
          [
            { beneficiary_id: 5, full_name: "Juan Reyes", relationship: "Child", age: 9, coverage_percent: 50 },
            { beneficiary_id: 5, full_name: "Juan Reyes Jr.", relationship: "Child", age: 9, coverage_percent: 50 },
          ],
          [current()],
          11,
        ),
      (error) => error.statusCode === 400 && /Duplicate beneficiary/.test(error.message),
    );
  });

  // OPENJSON's contract, and the only camelCase in this API. A key it does not
  // recognise reads as NULL rather than erroring, so a renamed key here would
  // surface as a row of nulls at approval time — long after the employee has
  // been told their request went through.
  test("the row is exactly the shape OPENJSON expects", () => {
    const changes = buildBeneficiaryChanges(
      [{ full_name: "Baby Reyes", relationship: "Child", age: 1, coverage_percent: 100 }],
      [],
      "11",
    );

    assert.deepEqual(changes[0], {
      beneficiaryId: null,
      enrollmentId: 11,
      action: "I",
      fullName: "Baby Reyes",
      relationship: "Child",
      age: 1,
      coveragePercent: 100,
    });
  });
});

describe("assertAddressBelongs", () => {
  test("accepts the caller's own address, across the string and number line", () => {
    assert.doesNotThrow(() =>
      assertAddressBelongs(3, { client_address_id: "3" }),
    );
  });

  test("refuses somebody else's address id", () => {
    assert.throws(
      () => assertAddressBelongs(4, { client_address_id: "3" }),
      (error) => error.statusCode === 403 && /does not belong to this enrollment/.test(error.message),
    );
  });

  // No stored address at all is refused rather than passed through. Reading
  // client_address_id off nothing would throw a TypeError, which reaches the
  // caller as a generic 500 instead of the honest answer.
  test("refuses when there is no stored address", () => {
    assert.throws(
      () => assertAddressBelongs(3, null),
      (error) => error.statusCode === 403,
    );
  });
});

describe("buildAddressChange", () => {
  const stored = {
    client_address_id: "3",
    barangay_id: "012801001",
    full_address: "12 Mabini Street",
    zip_code: "1000",
  };

  const submitted = {
    client_address_id: 3,
    barangay_id: "012801001",
    address_line: "12 Mabini Street",
    zip_code: "1000",
  };

  test("an unchanged address produces no row", () => {
    assert.equal(buildAddressChange(submitted, stored), null);
  });

  // The payload calls it address_line and the stored column is full_address.
  // Comparing the wrong pair would mark every address as changed while looking
  // entirely reasonable.
  test("notices a changed street, which is named differently on each side", () => {
    const change = buildAddressChange(
      { ...submitted, address_line: "14 Mabini Street" },
      stored,
    );

    assert.equal(change.addressLine, "14 Mabini Street");
  });

  test("notices a changed barangay", () => {
    const change = buildAddressChange(
      { ...submitted, barangay_id: "012801002" },
      stored,
    );

    assert.equal(change.barangayId, "012801002");
  });

  test("notices a changed zip code", () => {
    const change = buildAddressChange({ ...submitted, zip_code: "1001" }, stored);

    assert.equal(change.zipCode, "1001");
  });

  // barangay_id is VARCHAR and its codes carry leading zeros. Coercing it to a
  // number strips the zero, and the reference joins then resolve to nothing —
  // silently, because full_address and zip_code are stored separately so the
  // address still displays. That is the oldest trap in this project and the row
  // must carry the code exactly as it arrived.
  test("carries the barangay code as text, leading zero intact", () => {
    const change = buildAddressChange(
      { ...submitted, barangay_id: "012801002" },
      stored,
    );

    assert.equal(change.barangayId, "012801002");
    assert.equal(typeof change.barangayId, "string");
  });

  test("the row is exactly the shape OPENJSON expects", () => {
    const change = buildAddressChange({ ...submitted, zip_code: "1001" }, stored);

    assert.deepEqual(change, {
      clientAddressId: 3,
      action: "U",
      barangayId: "012801001",
      addressLine: "12 Mabini Street",
      zipCode: "1001",
    });
  });
});
