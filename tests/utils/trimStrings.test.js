import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { trimStrings, trimBeneficiaries } from "../../src/utils/trimStrings.js";

describe("trimStrings", () => {
  test("trims both ends and keeps the spaces inside", () => {
    const record = { first_name: "  Juan  ", last_name: "\tDela Cruz\n" };

    trimStrings(record);

    assert.deepEqual(record, { first_name: "Juan", last_name: "Dela Cruz" });
  });

  // The reason it exists: "   " is truthy, so it used to pass as present.
  test("turns a value of only spaces into an empty string", () => {
    assert.equal(trimStrings({ first_name: "   " }).first_name, "");
  });

  test("changes the record it was given, rather than a copy", () => {
    const record = { first_name: " Juan " };

    assert.equal(trimStrings(record), record);
    assert.equal(record.first_name, "Juan");
  });

  test("leaves everything that is not a string alone", () => {
    const nested = { full_name: "  kept as is  " };
    const record = { age: 12, consent: true, missing: null, list: [" a "], nested };

    trimStrings(record);

    assert.deepEqual(record, { age: 12, consent: true, missing: null, list: [" a "], nested });
  });

  test("tolerates a body that is not an object", () => {
    for (const value of [undefined, null, "text"])
      assert.equal(trimStrings(value), value);
  });
});

describe("trimBeneficiaries", () => {
  test("trims every record in the list", () => {
    const beneficiaries = [
      { full_name: " Ricardo Bautista ", relationship: "Father " },
      { full_name: "  Marco Bautista", relationship: " Son" },
    ];

    trimBeneficiaries(beneficiaries);

    assert.deepEqual(beneficiaries, [
      { full_name: "Ricardo Bautista", relationship: "Father" },
      { full_name: "Marco Bautista", relationship: "Son" },
    ]);
  });

  // validateCoverage refuses a non-array by name; this must not crash first.
  test("leaves anything that is not an array for validateCoverage to refuse", () => {
    for (const value of [undefined, null, "Ricardo", { full_name: " x " }])
      assert.doesNotThrow(() => trimBeneficiaries(value));
  });
});
