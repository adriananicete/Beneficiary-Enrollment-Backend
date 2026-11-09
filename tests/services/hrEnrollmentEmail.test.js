import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";

const { sendHrEnrollmentEmail, sendConfirmationEmail } = await import("../../src/services/emailService.js");
const { hrEnrollmentEmailTemplate } = await import("../../src/utils/hrEnrollmentEmailTemplate.js");

// The confirmation an HR person gets when they enroll themselves. They already have an account, so it has no password
// in it and says no account was made; the employee's confirmation (sendConfirmationEmail) has the temporary password.

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const stubFetch = () => {
  const calls = [];

  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    const body = /login\.microsoftonline\.com/.test(String(url)) ? { access_token: "tok", expires_in: 0 } : {};

    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => null } };
  };

  return calls;
};

const sentMessage = (calls) => JSON.parse(calls.find((call) => /graph\.microsoft\.com/.test(call.url)).options.body).message;

const enrolled = {
  to: "hr.person@phillife.example",
  policyNo: "G-TLI-26-136-2600030",
  username: "hr.phillife.2",
  firstName: "Maria",
  // the HR sign-in page, the site's root: not the employee login
  loginUrl: "https://example.test",
};

describe("sendHrEnrollmentEmail", () => {
  test("goes to the person, with its own subject, and carries no password", async () => {
    const calls = stubFetch();

    await sendHrEnrollmentEmail(enrolled);
    const message = sentMessage(calls);

    assert.equal(message.toRecipients[0].emailAddress.address, "hr.person@phillife.example");
    assert.equal(message.subject, "Your enrollment is complete");
    assert.equal(/password:/i.test(message.body.content.replace(/<[^>]+>/g, " ")), false, "no 'Password:' line");
    assert.match(message.body.content, /hr\.phillife\.2/, "the HR username, so they know which to use");
    assert.match(message.body.content, /G-TLI-26-136-2600030/);
    assert.match(message.body.content, /href="https:\/\/example\.test"/, "the sign-in button goes to the HR page");
    assert.doesNotMatch(message.body.content, /employee-login/, "never to the employee login");
    assert.match(message.body.content, /no new account was\s+created/i);
  });

  test("says the login is the same HR login, and where to look once signed in", async () => {
    const calls = stubFetch();

    await sendHrEnrollmentEmail(enrolled);
    const text = sentMessage(calls).body.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

    assert.match(text, /Your login is the same/);
    assert.match(text, /username and password you use as HR/);
    assert.match(text, /My Enrollment/);
    assert.match(text, /Your password has not changed/);
  });

  test("is not the employee's confirmation: that one carries the temporary password, this one never does", async () => {
    const employeeCalls = stubFetch();
    await sendConfirmationEmail({ ...enrolled, username: "EMP-1", password: "Temp-Pass-123" });
    const employee = sentMessage(employeeCalls);

    const hrCalls = stubFetch();
    await sendHrEnrollmentEmail(enrolled);
    const hr = sentMessage(hrCalls);

    assert.match(employee.body.content, /Temp-Pass-123/);
    assert.notEqual(employee.subject, hr.subject);
    assert.equal(hr.body.content.includes("Temp-Pass-123"), false);
  });

  test("carries the certificate as an attachment when there is one, and says so only then", async () => {
    const calls = stubFetch();
    const content = Buffer.from("%PDF-1.3 not really a certificate");

    await sendHrEnrollmentEmail({ ...enrolled, attachments: [{ name: "certificate.pdf", contentType: "application/pdf", content }] });
    const withPdf = sentMessage(calls);

    assert.deepEqual(withPdf.attachments, [
      { "@odata.type": "#microsoft.graph.fileAttachment", name: "certificate.pdf", contentType: "application/pdf", contentBytes: content.toString("base64") },
    ]);
    assert.match(withPdf.body.content, /Certificate of Coverage is attached/);

    const none = stubFetch();
    await sendHrEnrollmentEmail(enrolled);
    const without = sentMessage(none);

    assert.equal(without.attachments, undefined);
    assert.doesNotMatch(without.body.content, /attached/);
  });

  test("a failed send is thrown, so the caller can log it and still answer the enrollment", async () => {
    globalThis.fetch = async (url) =>
      /login\.microsoftonline\.com/.test(String(url))
        ? { ok: true, status: 200, json: async () => ({ access_token: "tok", expires_in: 0 }), text: async () => "{}", headers: { get: () => null } }
        : { ok: false, status: 503, text: async () => "down", headers: { get: () => null } };

    await assert.rejects(() => sendHrEnrollmentEmail(enrolled), (error) => error.status === 503);
  });
});

describe("hrEnrollmentEmailTemplate", () => {
  test("escapes what it is given", () => {
    const html = hrEnrollmentEmailTemplate({ policyNo: "P-1", username: "hr.<b>x</b>", firstName: "<script>alert(1)</script>", loginUrl: "https://example.test" }).content;

    assert.equal(html.includes("<script>alert(1)</script>"), false);
    assert.equal(html.includes("hr.<b>x</b>"), false);
    assert.match(html, /&lt;script&gt;/);
  });

  test("has no password to give: it takes none", () => {
    const html = hrEnrollmentEmailTemplate({ policyNo: "P-1", username: "hr.x", firstName: "A", loginUrl: "https://example.test", password: "Temp-Pass-123" }).content;

    assert.equal(html.includes("Temp-Pass-123"), false);
  });
});
