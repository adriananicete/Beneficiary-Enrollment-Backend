import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { claimDecisionEmailTemplate } from "../../src/utils/claimDecisionEmailTemplate.js";

// The email an employee gets when HR decides on their claim. Wording agreed
// 2026-10-12.

const build = (overrides = {}) =>
  claimDecisionEmailTemplate({
    employeeName: "Ana Reyes",
    claimType: "Test claim",
    status: "APPROVED",
    reviewRemarks: null,
    accountClosed: false,
    loginUrl: "https://example.com/employee-login",
    ...overrides,
  }).content;

describe("claimDecisionEmailTemplate", () => {
  test("each decision has its own heading and sentence", () => {
    assert.match(build({ status: "APPROVED" }), /Your claim was approved[\s\S]*Your HR has approved your Test claim claim\./);
    assert.match(build({ status: "REJECTED", reviewRemarks: "x" }), /Your claim was not approved[\s\S]*has not approved it\./);
    assert.match(
      build({ status: "RETURNED", reviewRemarks: "x" }),
      /Your claim needs more documents[\s\S]*Sign in, add what the note below asks for, and resubmit\./,
    );
  });

  test("greets the employee by name", () => {
    assert.match(build(), /Hi Ana Reyes,/);
  });

  // HR's note, the employee's name and the type name all come from text
  // somebody typed. None of it may become markup.
  test("the remarks, the name and the claim type are escaped", () => {
    const html = build({
      employeeName: "<b>Ana</b>",
      claimType: "TPD <script>",
      status: "REJECTED",
      reviewRemarks: "<img src=x onerror=alert(1)>",
    });

    assert.doesNotMatch(html, /<b>Ana<\/b>|<script>|<img src=x/);
    assert.match(html, /&lt;b&gt;Ana&lt;\/b&gt;/);
    assert.match(html, /TPD &lt;script&gt;/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  });

  test("HR's note is shown when there is one, and nothing is drawn when there is none", () => {
    assert.match(build({ reviewRemarks: "Paid next month" }), /Note from your HR[\s\S]*Paid next month/);
    assert.doesNotMatch(build({ reviewRemarks: null }), /Note from your HR/);
  });

  // The account is closed in the same transaction as the approval, so the
  // email is the last thing the employee can read from this system.
  test("an approval that closed the account says so, and has no Sign in button", () => {
    const html = build({ accountClosed: true });

    assert.match(html, /your account on this\s+system has been closed/);
    assert.match(html, /keep this email for your\s+records/);
    assert.doesNotMatch(html, /https:\/\/example\.com\/employee-login/);
  });

  test("otherwise the Sign in button goes to the employee login", () => {
    for (const status of ["APPROVED", "REJECTED", "RETURNED"]) {
      const html = build({ status, reviewRemarks: "x" });

      assert.match(html, /href="https:\/\/example\.com\/employee-login"/, status);
      assert.doesNotMatch(html, /has been closed/, status);
    }
  });

  // Only an approval can close an account. A rejection never says so, even
  // if the flag were somehow set.
  test("only an approval mentions the account being closed", () => {
    assert.doesNotMatch(build({ status: "REJECTED", reviewRemarks: "x", accountClosed: true }), /has been closed/);
  });
});
