import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";
import { makeNext, makeReq, makeRes } from "../helpers/http.js";

const {
  belongsToClaim,
  cancelMyClaim,
  cancelRemarksOf,
  claimDocumentOf,
  claimTypeOf,
  employeeClaimDetailOf,
  employeeClaimOf,
} = await import("../../src/controllers/claimController.js");

// The employee's side of claims. What is tested here is what this side
// decides: what leaves, and what is refused before the database is asked. The
// scoping is in the procedures, read back 2026-10-12, and is proven by the
// manual run.

// A detail header as usp_sel_claim_by_id returns it, every column.
const HEADER = {
  claim_id: "30",
  client_id: "75",
  enrollment_id: "76",
  employee_name: "Ana Reyes",
  email_address: "ana@coforge.com",
  claim_type_id: "1",
  claim_type_code: "TEST-CLAIM",
  claim_type_desc: "Test claim",
  ends_coverage: false,
  claim_status: "PENDING",
  filed_by: "12",
  filed_by_role: "Employee",
  filed_date: new Date("2026-10-12T02:00:00Z"),
  resubmitted_date: null,
  reviewed_by: "3",
  reviewed_date: null,
  review_remarks: null,
  cancelled_by: null,
  cancelled_date: null,
  cancel_remarks: null,
  closed_by: null,
  closed_date: null,
  ticket_status: "QUEUED",
  ticket_reference: "TKT-1",
};

// Columns that are for HR, or are user ids, and must never reach the
// employee's browser.
const NEVER_TO_THE_EMPLOYEE = [
  "client_id",
  "enrollment_id",
  "employee_name",
  "email_address",
  "filed_by",
  "filed_by_role",
  "reviewed_by",
  "cancelled_by",
  "closed_by",
  "ticket_status",
  "ticket_reference",
];

describe("what leaves, field by field", () => {
  test("the claim detail carries the employee's fields and none of HR's", () => {
    const shown = employeeClaimDetailOf(HEADER);

    assert.deepEqual(Object.keys(shown).sort(), [
      "cancel_remarks",
      "cancelled_date",
      "claim_id",
      "claim_status",
      "claim_type_code",
      "claim_type_desc",
      "claim_type_id",
      "closed_date",
      "ends_coverage",
      "filed_date",
      "resubmitted_date",
      "review_remarks",
      "reviewed_date",
    ]);

    for (const column of NEVER_TO_THE_EMPLOYEE) assert.equal(column in shown, false, column);
  });

  // A column a procedure gains later stays out until somebody adds it here.
  test("a list row carries the named fields, and nothing a procedure adds later", () => {
    const shown = employeeClaimOf({ ...HEADER, some_new_column: "x" });

    assert.equal("some_new_column" in shown, false);
    for (const column of NEVER_TO_THE_EMPLOYEE) assert.equal(column in shown, false, column);
  });

  // The content leaves only through its own route, with its own headers.
  test("a document is described without its content or its hash", () => {
    const shown = claimDocumentOf({
      claim_document_id: "9",
      requirement_id: "1",
      requirement_desc: "Test document (required)",
      file_name: "scan.pdf",
      mime_type: "application/pdf",
      byte_size: 1024,
      sha256: "0".repeat(64),
      content: Buffer.from("%PDF-"),
      uploaded_by: "12",
      uploaded_date: new Date("2026-10-12T02:00:00Z"),
    });

    assert.deepEqual(Object.keys(shown).sort(), [
      "byte_size",
      "claim_document_id",
      "file_name",
      "mime_type",
      "requirement_desc",
      "requirement_id",
      "uploaded_date",
    ]);
  });

  test("a type carries its own requirements, each with the field to send it in", () => {
    const requirements = [
      { requirement_id: "1", claim_type_id: "1", requirement_desc: "Required", is_required: true, sort_order: 1 },
      { requirement_id: "7", claim_type_id: "4", requirement_desc: "Other type", is_required: true, sort_order: 1 },
      // A number on one side and text on the other must still match.
      { requirement_id: "2", claim_type_id: 1, requirement_desc: "Optional", is_required: false, sort_order: 2 },
    ];

    const shown = claimTypeOf(
      { claim_type_id: "1", claim_type_code: "TEST-CLAIM", claim_type_desc: "Test claim", ends_coverage: false },
      requirements,
    );

    assert.deepEqual(shown.requirements, [
      { requirement_id: "1", requirement_desc: "Required", is_required: true, sort_order: 1, field: "requirement_1" },
      { requirement_id: "2", requirement_desc: "Optional", is_required: false, sort_order: 2, field: "requirement_2" },
    ]);
  });
});

describe("a document belongs to the claim in the URL", () => {
  test("the same claim, whether the ids are text or numbers", () => {
    assert.equal(belongsToClaim({ claim_id: "30" }, "30"), true);
    assert.equal(belongsToClaim({ claim_id: 30 }, "30"), true);
  });

  // The caller's own document, under the caller's other claim. Without this
  // check a URL could pair any claim with any document.
  test("another claim, or no document at all, is refused", () => {
    assert.equal(belongsToClaim({ claim_id: "31" }, "30"), false);
    assert.equal(belongsToClaim(undefined, "30"), false);
    assert.equal(belongsToClaim(null, "30"), false);
  });
});

describe("cancel_remarks", () => {
  test("optional: absent, null or blank is null", () => {
    for (const value of [undefined, null, "", "   "]) assert.equal(cancelRemarksOf(value), null, JSON.stringify(value));
  });

  test("trimmed", () => {
    assert.equal(cancelRemarksOf("  filed by mistake  "), "filed by mistake");
  });

  // The column is varchar(500). Pinned as a literal.
  test("500 characters is accepted and 501 is 400", () => {
    assert.equal(cancelRemarksOf("x".repeat(500)).length, 500);
    assert.throws(() => cancelRemarksOf("x".repeat(501)), (error) => error.statusCode === 400);
  });

  test("anything but text is 400", () => {
    for (const value of [1, true, {}, ["x"], { toString: 1 }])
      assert.throws(() => cancelRemarksOf(value), (error) => error.statusCode === 400, JSON.stringify(value));
  });

  // Refused before getPool, so this runs without a database.
  test("a bad cancel_remarks is refused before the database is touched", async () => {
    const next = makeNext();

    await cancelMyClaim(
      makeReq({ params: { claim_id: "30" }, body: { cancel_remarks: 7 }, user: { user_id: 12 } }),
      makeRes(),
      next,
    );

    assert.deepEqual(next.refusal(), { statusCode: 400, message: "cancel_remarks must be text" });
  });
});
