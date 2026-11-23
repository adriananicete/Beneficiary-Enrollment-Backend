import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { CLAIM_FILED_SUBJECT, claimFiledEmailTemplate } from "../../src/utils/claimFiledEmailTemplate.js";

// The email an employee gets when HR files a claim in their name (DBA request
// 36, decided 2026-11-12).

const build = (overrides = {}) =>
  claimFiledEmailTemplate({
    employeeName: "Ana Reyes",
    claimType: "Total and Permanent Disability",
    loginUrl: "https://example.com/employee-login",
    ...overrides,
  }).content;

describe("claimFiledEmailTemplate", () => {
  test("says HR filed it, names the type, and that the decision will follow", () => {
    const html = build();

    assert.equal(CLAIM_FILED_SUBJECT, "A claim was filed for you");
    assert.match(html, /Hi Ana Reyes,/);
    assert.match(html, /Your HR has filed a Total and Permanent Disability claim for\s+you\./);
    assert.match(html, /you will receive an email with the\s+decision/);
  });

  // The employee may cancel a claim HR filed for them (decided 2026-11-12).
  test("tells them they can cancel it, and links to the sign-in", () => {
    const html = build();

    assert.match(html, /cancel it there if you\s+did not ask for it/);
    assert.match(html, /href="https:\/\/example\.com\/employee-login"/);
  });

  // The name and the type are text somebody typed. Neither may become markup.
  test("the name and the claim type are escaped", () => {
    const html = build({ employeeName: "<b>Ana</b>", claimType: "TPD <script>" });

    assert.doesNotMatch(html, /<b>Ana<\/b>|<script>/);
    assert.match(html, /&lt;b&gt;Ana&lt;\/b&gt;/);
    assert.match(html, /TPD &lt;script&gt;/);
  });
});
