import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { escapeHtml } from "../../src/utils/escapeHtml.js";
import { emailTemplate } from "../../src/utils/emailTemplate.js";
import { credentialsEmailTemplate } from "../../src/utils/credentialsEmailTemplate.js";
import { invitationEmailTemplate } from "../../src/utils/invitationEmailTemplate.js";
import { changeRequestEmailTemplate } from "../../src/utils/changeRequestEmailTemplate.js";

const PAYLOAD = `<script>alert('x')</script>`;

describe("escapeHtml", () => {
  test("escapes the five characters that change the meaning of markup", () => {
    assert.equal(escapeHtml("<"), "&lt;");
    assert.equal(escapeHtml(">"), "&gt;");
    assert.equal(escapeHtml('"'), "&quot;");
    assert.equal(escapeHtml("'"), "&#39;");
    assert.equal(escapeHtml("&"), "&amp;");
  });

  test("escapes the ampersand first, so nothing is escaped twice", () => {
    // The order in the implementation is load-bearing. Replacing `<` before `&`
    // turns "<" into "&lt;" and then into "&amp;lt;", which the reader sees as
    // the literal text "&lt;" rather than a less-than sign.
    assert.equal(escapeHtml("<"), "&lt;");
    assert.equal(escapeHtml("Tom & Jerry"), "Tom &amp; Jerry");
    assert.ok(!escapeHtml("<b>").includes("&amp;lt;"));
  });

  test("leaves ordinary text alone", () => {
    assert.equal(escapeHtml("Angela Bautista"), "Angela Bautista");
    assert.equal(escapeHtml("EMP-020"), "EMP-020");
    assert.equal(escapeHtml("2012-0053"), "2012-0053");
  });

  test("null and undefined become empty rather than the word", () => {
    // Without the ?? "" these would render as the text "null" in an email.
    assert.equal(escapeHtml(null), "");
    assert.equal(escapeHtml(undefined), "");
  });

  test("coerces a non-string rather than throwing", () => {
    assert.equal(escapeHtml(0), "0");
    assert.equal(escapeHtml(12345), "12345");
  });
});

// One shared escaper, four templates, and no template that is the odd one out.
//
// This is consistency rather than a live fix, and the distinction is worth
// keeping: only reviewRemarks crosses a user boundary, and it has been escaped
// since it was written. The rest is the recipient's own data going to the
// recipient's own inbox. What these pin is that a value cannot reach any of the
// four as markup — so the next template does not have to work out which half of
// a split convention it belongs to.
describe("every template escapes what is interpolated into it", () => {
  const cases = [
    {
      name: "emailTemplate — enrollment confirmation",
      build: (value) =>
        emailTemplate({
          policyNo: value,
          username: value,
          firstName: value,
          lastName: value,
          password: value,
          loginUrl: "https://example.com/login",
        }),
    },
    {
      name: "credentialsEmailTemplate — HR reissue",
      build: (value) =>
        credentialsEmailTemplate({
          firstName: value,
          username: value,
          password: value,
          loginUrl: "https://example.com/login",
        }),
    },
    {
      name: "invitationEmailTemplate",
      build: (value) =>
        invitationEmailTemplate({
          companyName: value,
          enrollmentUrl: "https://example.com/enroll?token=abc",
        }),
    },
    {
      name: "changeRequestEmailTemplate",
      build: (value) =>
        changeRequestEmailTemplate({
          firstName: value,
          approved: false,
          reviewRemarks: value,
          loginUrl: "https://example.com/login",
        }),
    },
  ];

  for (const { name, build } of cases) {
    test(`${name} — a script tag arrives as text`, () => {
      const { content } = build(PAYLOAD);

      assert.ok(
        !content.includes("<script>"),
        "a raw <script> tag reached the email body",
      );
      assert.match(content, /&lt;script&gt;/);
    });

    test(`${name} — an attribute break-out is escaped`, () => {
      // Assert on the injected substring exactly as it would survive unescaped.
      // The first version of this looked for `onmouseover="alert(1)"` with a
      // closing quote the payload never had, so it passed with the escaping
      // stripped out — a test that could not fail, caught by stripping it.
      const { content } = build(`" onmouseover="alert(1)`);

      assert.ok(
        !content.includes(`" onmouseover="`),
        "the quote closed the attribute and a handler was injected",
      );
      assert.match(content, /&quot; onmouseover=&quot;/);
    });
  }

  test("the link is left alone, and that is deliberate", () => {
    // loginUrl and enrollmentUrl are built from APP_URL and a token this system
    // generated — never from a form. Escaping them would turn the `&` between
    // query parameters into `&amp;`, which is correct in HTML but is a change
    // to a working link made for no reason.
    const { content } = invitationEmailTemplate({
      companyName: "Coforge",
      enrollmentUrl: "https://example.com/enroll?token=abc&x=1",
    });

    assert.match(content, /href="https:\/\/example\.com\/enroll\?token=abc&x=1"/);
  });
});
