import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { changeRequestAuditEntry } from "../../src/utils/changeRequestAudit.js";

// The request as ChangeRequestModel.getChangeRequestById returns it before the decision.
const DETAILS = {
  request: { client_change_request_id: "14", client_id: "75" },
  changedFields: [
    { field_name: "First Name", current_value: "Ana", proposed_value: "Anna" },
    { field_name: "Email Address", current_value: "ana@old.example", proposed_value: "anna@new.example" },
    { field_name: "Middle Name", current_value: "Cruz", proposed_value: null },
  ],
  addresses: [
    { change_action: "U", client_address_id: "9", address_line: "12 Rizal St", zip_code: "1100" },
    { change_action: "D", client_address_id: "10", address_line: null, zip_code: null },
  ],
  beneficiaries: [
    { change_action: "I", full_name: "Liza Reyes", relationship: "Spouse", age: 31, coverage_percent: 50 },
    { change_action: "U", full_name: "Ben Reyes", relationship: "Son", age: 6, coverage_percent: 50 },
    { change_action: "D", full_name: "Old Name", relationship: null, age: null, coverage_percent: null },
  ],
};

describe("changeRequestAuditEntry — an approval", () => {
  const entry = changeRequestAuditEntry(DETAILS, { approved: true, reviewRemarks: "Documents checked" });

  test("the module says what was decided", () => {
    assert.equal(entry.object, "Profile change request (approved)");
  });

  test("the status goes from pending to approved, with the reason", () => {
    assert.equal(entry.oldValues.Status, "PENDING");
    assert.equal(entry.newValues.Status, "APPROVED");
    assert.equal(entry.newValues["Review remarks"], "Documents checked");
  });

  test("each changed field has what it was and what it is now", () => {
    assert.equal(entry.oldValues["First Name"], "Ana");
    assert.equal(entry.newValues["First Name"], "Anna");
    assert.equal(entry.oldValues["Email Address"], "ana@old.example");
    assert.equal(entry.newValues["Email Address"], "anna@new.example");
  });

  test("a value cleared by the change is an empty text, not the word null", () => {
    assert.equal(entry.oldValues["Middle Name"], "Cruz");
    assert.equal(entry.newValues["Middle Name"], "");
  });

  test("addresses and beneficiaries are described on the new side, numbered", () => {
    assert.equal(entry.newValues["Address 1"], "Updated: 12 Rizal St, 1100");
    assert.equal(entry.newValues["Address 2"], "Removed: address 10", "a removal carries no address text");
    assert.equal(entry.newValues["Beneficiary 1"], "Added: Liza Reyes, Spouse, age 31, 50%");
    assert.equal(entry.newValues["Beneficiary 2"], "Updated: Ben Reyes, Son, age 6, 50%");
    assert.equal(entry.newValues["Beneficiary 3"], "Removed: Old Name", "missing parts are left out, not printed as null");
  });

  test("what was before an address or a beneficiary is not claimed", () => {
    assert.equal(Object.keys(entry.oldValues).some((key) => /^(Address|Beneficiary)/.test(key)), false);
  });

  test("a note left empty is not recorded", () => {
    const quiet = changeRequestAuditEntry(DETAILS, { approved: true, reviewRemarks: null });
    assert.equal("Review remarks" in quiet.newValues, false);
  });

  test("both sides are plain objects of text, which is what the Audit Trail parses", () => {
    for (const side of [entry.oldValues, entry.newValues])
      for (const value of Object.values(side)) assert.equal(typeof value, "string");
    assert.deepEqual(JSON.parse(JSON.stringify(entry.newValues)), entry.newValues);
  });
});

describe("changeRequestAuditEntry — a rejection", () => {
  const entry = changeRequestAuditEntry(DETAILS, { approved: false, reviewRemarks: "TIN does not match" });

  test("the module says it was rejected", () => {
    assert.equal(entry.object, "Profile change request (rejected)");
  });

  test("it records the decision and the reason, and none of the proposed changes, which were not applied", () => {
    assert.deepEqual(entry.oldValues, { Status: "PENDING" });
    assert.deepEqual(entry.newValues, { Status: "REJECTED", "Review remarks": "TIN does not match" });
  });
});

describe("changeRequestAuditEntry — what it tolerates", () => {
  test("a request with nothing to compare still gets its decision", () => {
    for (const details of [undefined, null, {}, { changedFields: [], addresses: [], beneficiaries: [] }]) {
      const entry = changeRequestAuditEntry(details, { approved: true, reviewRemarks: null });
      assert.deepEqual(entry.oldValues, { Status: "PENDING" });
      assert.deepEqual(entry.newValues, { Status: "APPROVED" });
    }
  });

  test("an action it does not know is called a change, never left blank", () => {
    const entry = changeRequestAuditEntry(
      { addresses: [{ change_action: "X", address_line: "1 Main St", zip_code: null }] },
      { approved: true, reviewRemarks: null },
    );
    assert.equal(entry.newValues["Address 1"], "Changed: 1 Main St");
  });
});
