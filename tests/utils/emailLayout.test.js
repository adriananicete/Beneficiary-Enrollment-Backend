import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { emailLayout } from "../../src/utils/emailLayout.js";
import { emailTemplate } from "../../src/utils/emailTemplate.js";
import { credentialsEmailTemplate } from "../../src/utils/credentialsEmailTemplate.js";
import { invitationEmailTemplate } from "../../src/utils/invitationEmailTemplate.js";
import { certificateEmailTemplate } from "../../src/utils/certificateEmailTemplate.js";
import { changeRequestEmailTemplate } from "../../src/utils/changeRequestEmailTemplate.js";

// One design for five emails. What these pin is the part a reader cannot check
// by opening one message: that all five agree.
//
// Before this branch four of them shared a layout by having four copies of it,
// and the enrollment confirmation had a different design with no logo. The
// copies were identical, so nothing was visibly wrong — which is exactly why
// centring the card needed the same edit in five places and got it in none.
// A centred cell whose contents are the card, rather than merely a centred cell
// anywhere in the document.
//
// The distinction is the whole assertion and the first version did not make it:
// the shell has two centred cells — this one and the logo's — so
// `/<td align="center"/` matched the logo's and **passed with the centring
// removed**. Caught by deleting the align and watching nothing go red. The logo
// cell holds an `<img>`, so requiring a `<table>` next tells the two apart
// without pinning the padding, which is arbitrary and should be free to change.
const CENTRED_CARD = /<td align="center"[^>]*>\s*<table[\s\S]{0,200}width="450"/;

const TEMPLATES = [
  {
    name: "emailTemplate — enrollment confirmation",
    build: () =>
      emailTemplate({
        policyNo: "G-TLI-26-136-2600032",
        username: "EMP-020",
        firstName: "John",
        password: "Temp@1234",
        loginUrl: "https://example.com/employee-login",
      }),
  },
  {
    name: "credentialsEmailTemplate",
    build: () =>
      credentialsEmailTemplate({
        firstName: "John",
        username: "EMP-020",
        password: "Temp@1234",
        loginUrl: "https://example.com/employee-login",
      }),
  },
  {
    name: "invitationEmailTemplate",
    build: () =>
      invitationEmailTemplate({
        companyName: "Coforge BPS Philippines, Inc.",
        enrollmentUrl: "https://example.com/enroll?token=abc",
      }),
  },
  {
    name: "certificateEmailTemplate",
    build: () =>
      certificateEmailTemplate({
        firstName: "John",
        policyNo: "G-TLI-26-136-2600032",
      }),
  },
  {
    name: "changeRequestEmailTemplate",
    build: () =>
      changeRequestEmailTemplate({
        firstName: "John",
        approved: true,
        reviewRemarks: "Confirmed by phone.",
        loginUrl: "https://example.com/employee-login",
      }),
  },
];

describe("emailLayout — the shell every email shares", () => {
  const { contentType, content } = emailLayout({
    title: "A title",
    heading: "A heading",
    body: "<p>A body</p>",
  });

  test("is announced to Graph as HTML", () => {
    assert.equal(contentType, "HTML");
  });

  test("puts the title, heading and body where it was given them", () => {
    assert.match(content, /<title>A title<\/title>/);
    assert.match(content, /A heading/);
    assert.match(content, /<p>A body<\/p>/);
  });

  // The reason this branch exists. `align="center"` on the containing cell is
  // what Outlook honours — it renders through Word, which ignores `margin: 0
  // auto` — so without it the card sits hard against the left edge. That is
  // what all five emails did.
  test("centres the card with align, not with a margin Word ignores", () => {
    assert.match(content, CENTRED_CARD);
    assert.doesNotMatch(content, /margin:\s*0 auto/);
  });

  // A fixed 450 overflows a 400-wide phone and the reader scrolls sideways to
  // read a sentence.
  test("caps the card at the screen width", () => {
    assert.match(content, /width: 450px; max-width: 100%/);
  });
});

describe("every email is built from that shell", () => {
  for (const { name, build } of TEMPLATES) {
    test(`${name} — carries the logo, centred, capped`, () => {
      const { contentType, content } = build();

      assert.equal(contentType, "HTML");
      assert.match(content, /PhilLife_Color_tcjvib\.png/, "no logo");
      assert.match(content, CENTRED_CARD, "not centred");
      assert.match(content, /width: 450px; max-width: 100%/, "not capped");
    });
  }

  // Pinned as a count rather than as a shape. The shell is one string in one
  // file now, so the way this regresses is a template that stops using it and
  // grows its own copy — which looks right in isolation and is invisible from
  // inside any single message.
  test("all five, and none of them carrying a second card", () => {
    assert.equal(TEMPLATES.length, 5);

    for (const { name, build } of TEMPLATES) {
      const cards = build().content.match(/width: 450px; max-width: 100%/g);
      assert.equal(cards.length, 1, `${name} draws ${cards.length} cards`);
    }
  });
});

// Mirrors changeRequestEmailTemplate.test.js, which pins the same rule for the
// approval email. The certificate is built before either email is sent and can
// fail while the email goes out regardless, so the line has to follow the
// attachment rather than the intention.
describe("the confirmation email mentions its attachment only when it has one", () => {
  const build = (certificateAttached) =>
    emailTemplate({
      policyNo: "G-TLI-26-136-2600032",
      username: "EMP-020",
      firstName: "John",
      password: "Temp@1234",
      loginUrl: "https://example.com/employee-login",
      certificateAttached,
    }).content;

  test("says so when the PDF is attached", () => {
    assert.match(build(true), /Certificate of Coverage is attached/);
  });

  test("says nothing at all when it is not", () => {
    assert.doesNotMatch(build(false), /Certificate of Coverage/);
  });

  test("and says nothing when nobody passed the flag", () => {
    // The default matters: enrollmentService sends this email whether or not
    // the certificate could be built, and a template defaulting to true would
    // promise an attachment on exactly the runs that failed to make one.
    assert.doesNotMatch(
      emailTemplate({
        policyNo: "G-TLI-26-136-2600032",
        username: "EMP-020",
        firstName: "John",
        password: "Temp@1234",
        loginUrl: "https://example.com/employee-login",
      }).content,
      /Certificate of Coverage/,
    );
  });
});
