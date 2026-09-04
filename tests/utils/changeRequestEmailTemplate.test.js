import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { changeRequestEmailTemplate } from "../../src/utils/changeRequestEmailTemplate.js";

const build = (overrides = {}) =>
  changeRequestEmailTemplate({
    firstName: "Angela",
    approved: true,
    reviewRemarks: null,
    loginUrl: "https://example.com/login",
    ...overrides,
  });

describe("changeRequestEmailTemplate", () => {
  test("returns the shape the Graph sender expects", () => {
    const body = build();

    assert.equal(body.contentType, "HTML");
    assert.equal(typeof body.content, "string");
    assert.ok(body.content.length > 0);
  });

  test("an approval and a rejection do not read the same", () => {
    assert.match(build({ approved: true }).content, /approved/i);
    assert.match(build({ approved: false }).content, /another look/i);
  });

  test("the remarks block is absent when there are no remarks", () => {
    // A rejection requires remarks, an approval usually has none. An empty
    // bordered box in the email would look like something failed to load.
    const content = build({ approved: true, reviewRemarks: null }).content;

    assert.ok(!content.includes("border-left"));
  });

  test("the remarks are shown when they exist", () => {
    const content = build({
      approved: false,
      reviewRemarks: "Please attach your marriage certificate.",
    }).content;

    assert.match(content, /marriage certificate/);
  });
});

describe("escaping — the only guard on HR's free text", () => {
  // reviewRemarks is written by HR and rendered into an email the employee
  // opens. It is the one place in this system where one user's text reaches
  // another user's inbox, which is why this template escapes and the other
  // three do not.

  test("a script tag arrives escaped, not as markup", () => {
    const content = build({
      approved: false,
      reviewRemarks: "<script>alert('x')</script>",
    }).content;

    assert.ok(
      !content.includes("<script>"),
      "a raw <script> tag reached the email body",
    );
    assert.match(content, /&lt;script&gt;/);
  });

  test("an attribute break-out is escaped", () => {
    const content = build({
      approved: false,
      reviewRemarks: `" onmouseover="alert(1)`,
    }).content;

    assert.ok(!content.includes(`onmouseover="alert(1)"`));
    assert.match(content, /&quot;|&#39;/);
  });

  test("an ampersand is escaped first, so escaping is not double-applied", () => {
    const content = build({
      approved: false,
      reviewRemarks: "Tom & Jerry",
    }).content;

    assert.match(content, /Tom &amp; Jerry/);
    assert.ok(!content.includes("&amp;amp;"));
  });

  test("the recipient's own name is escaped too", () => {
    // Lower risk — a name is text the recipient supplied about themselves — but
    // it is interpolated into the same document and costs nothing to cover.
    const content = build({ firstName: "<b>Angela</b>" }).content;

    assert.ok(!content.includes("<b>Angela</b>"));
    assert.match(content, /&lt;b&gt;Angela/);
  });
});
