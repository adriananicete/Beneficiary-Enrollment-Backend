import { describe, test, afterEach } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";

const {
  sendInvitationEmail,
  sendChangeRequestDecisionEmail,
  sendConfirmationEmail,
} = await import("../../src/services/emailService.js");

// This file was written off as untestable — "Graph over fetch, not reachable by
// this kind of test" — and that was wrong. `fetch` is a global in this Node, so
// a test can put its own in place and take it away again. No mocking library,
// no experimental flag, no new dependency.
//
// What is worth covering is not the mail. It is the token cache, which decides
// how many times an hour this backend asks Microsoft for a credential, and
// graphSendError, which carries a cross-module contract: invitationService
// decides whether to retry by reading `error.status` off the thrown error, so a
// send failure that arrives without one silently stops being retryable and the
// circuit breaker stops counting what it thinks it counts.

const TOKEN_URL = /login\.microsoftonline\.com/;
const SEND_URL = /graph\.microsoft\.com/;

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const jsonResponse = (body) => ({
  ok: true,
  status: 200,
  json: async () => body,
  text: async () => JSON.stringify(body),
  headers: { get: () => null },
});

const failedResponse = (status, text = "denied", headers = {}) => ({
  ok: false,
  status,
  text: async () => text,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
});

// expires_in of 0 puts the expiry a minute in the past, because getAccessToken
// subtracts a refresh margin. So nothing survives into the next test and each
// one starts from an empty cache — except the caching tests at the bottom,
// which ask for a long-lived token on purpose and are declared last for that
// reason.
const stubFetch = ({ token = jsonResponse({ access_token: "tok-123", expires_in: 0 }), send = jsonResponse({}) } = {}) => {
  const calls = [];

  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });

    if (TOKEN_URL.test(String(url))) return typeof token === "function" ? token(calls) : token;
    return typeof send === "function" ? send(calls) : send;
  };

  return calls;
};

const invitation = {
  to: "ana@coforge.com",
  companyName: "Coforge",
  enrollmentUrl: "https://example.test/?token=abc",
};

describe("emailService — the failure a caller has to act on", () => {
  // invitationService.isRetryable reads error.status. Without it, `undefined >= 500`
  // is false and `undefined === 429` is false, so every failure becomes
  // permanent — the retry disappears and nothing announces it.
  test("a failed send carries the HTTP status on the error", async () => {
    stubFetch({ send: failedResponse(429, "throttled") });

    const error = await sendInvitationEmail(invitation).catch((e) => e);

    assert.equal(error.status, 429);
    assert.match(error.message, /429/);
  });

  test("a 5xx carries its status too, so it stays retryable", async () => {
    stubFetch({ send: failedResponse(503) });

    const error = await sendInvitationEmail(invitation).catch((e) => e);

    assert.equal(error.status, 503);
  });

  // Graph answers a throttle with Retry-After in seconds. invitationService
  // waits that long rather than its own backoff, capped at thirty seconds.
  test("reads Retry-After off the response", async () => {
    stubFetch({ send: failedResponse(429, "throttled", { "retry-after": "17" }) });

    const error = await sendInvitationEmail(invitation).catch((e) => e);

    assert.equal(error.retryAfterSeconds, 17);
  });

  // null rather than NaN or 0. The caller does `error.retryAfterSeconds ?
  // ... : backoffMs`, so a NaN would be truthy and produce a NaN wait.
  for (const [label, value] of [
    ["absent", undefined],
    ["not a number", "soon"],
    ["zero", "0"],
    ["negative", "-5"],
  ]) {
    test(`answers null when Retry-After is ${label}`, async () => {
      stubFetch({
        send: failedResponse(429, "throttled", value === undefined ? {} : { "retry-after": value }),
      });

      const error = await sendInvitationEmail(invitation).catch((e) => e);

      assert.equal(error.retryAfterSeconds, null);
    });
  }

  test("a failed token request reaches the caller rather than being swallowed", async () => {
    stubFetch({ token: failedResponse(401, "bad client secret") });

    await assert.rejects(
      () => sendInvitationEmail(invitation),
      /token request failed: 401/,
    );
  });
});

describe("emailService — what is actually sent", () => {
  test("authorises with the token it fetched", async () => {
    const calls = stubFetch();

    await sendInvitationEmail(invitation);

    const send = calls.find((call) => SEND_URL.test(call.url));

    assert.equal(send.options.headers.Authorization, "Bearer tok-123");
  });

  test("addresses the recipient it was given and does not keep a copy", async () => {
    const calls = stubFetch();

    await sendInvitationEmail(invitation);

    const send = calls.find((call) => SEND_URL.test(call.url));
    const payload = JSON.parse(send.options.body);

    assert.equal(payload.message.toRecipients[0].emailAddress.address, "ana@coforge.com");
    assert.equal(payload.saveToSentItems, "false");
  });

  // The subject is the only part of a decision email the employee sees before
  // opening it, and the two outcomes must not read alike.
  test("the decision email says which decision it carries", async () => {
    const calls = stubFetch();

    await sendChangeRequestDecisionEmail({
      to: "ana@coforge.com",
      firstName: "Ana",
      approved: true,
      reviewRemarks: null,
    });

    await sendChangeRequestDecisionEmail({
      to: "ana@coforge.com",
      firstName: "Ana",
      approved: false,
      reviewRemarks: "TIN does not match your ID",
    });

    const subjects = calls
      .filter((call) => SEND_URL.test(call.url))
      .map((call) => JSON.parse(call.options.body).message.subject);

    assert.match(subjects[0], /have been updated/);
    assert.match(subjects[1], /were not applied/);
    assert.notEqual(subjects[0], subjects[1]);
  });
});

describe("emailService — the Certificate of Coverage attachment", () => {
  const confirmation = {
    to: "lorenz@coforge.com",
    policyNo: "G-TLI-26-136-2600030",
    username: "EMP-096",
    firstName: "Lorenz",
    lastName: "Artillagas",
    password: "Temp-Pass-123",
    loginUrl: "https://example.test/employee-login",
  };

  const sentMessage = (calls) =>
    JSON.parse(calls.find((call) => SEND_URL.test(call.url)).options.body).message;

  test("carries the certificate as a Graph file attachment, base64-encoded", async () => {
    const calls = stubFetch();
    const content = Buffer.from("%PDF-1.3 not really a certificate");

    await sendConfirmationEmail({
      ...confirmation,
      attachments: [{ name: "Certificate-of-Coverage-74.pdf", contentType: "application/pdf", content }],
    });

    assert.deepEqual(sentMessage(calls).attachments, [
      {
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: "Certificate-of-Coverage-74.pdf",
        contentType: "application/pdf",
        contentBytes: content.toString("base64"),
      },
    ]);
  });

  // A certificate that could not be built must not change the email that
  // carries the temporary password. No attachment means no `attachments` key
  // at all — the same request as before attachments existed.
  test("sends the credentials unchanged when there is nothing to attach", async () => {
    const calls = stubFetch();

    await sendConfirmationEmail({ ...confirmation, attachments: [] });
    await sendConfirmationEmail(confirmation);

    const [withEmpty, withNone] = calls
      .filter((call) => SEND_URL.test(call.url))
      .map((call) => JSON.parse(call.options.body).message);

    assert.equal("attachments" in withEmpty, false);
    assert.equal("attachments" in withNone, false);
    assert.match(withNone.body.content, /Temp-Pass-123/);
  });
});

// Declared last on purpose: these are the only tests that ask for a token with
// a real lifetime, and a cached token outlives the test that cached it.
describe("emailService — the token cache", () => {
  const tokenCount = (calls) => calls.filter((call) => TOKEN_URL.test(call.url)).length;

  // The whole reason the catch sets tokenRequest back to null. Caching a
  // rejected promise would replay the same failure to every later caller —
  // during a bulk send, that turns one bad moment into a thousand failed
  // addresses that were never attempted.
  test("a failed token request is not cached", async () => {
    const calls = stubFetch({ token: failedResponse(500, "upstream") });

    await sendInvitationEmail(invitation).catch(() => {});
    await sendInvitationEmail(invitation).catch(() => {});

    assert.equal(tokenCount(calls), 2, "the second call replayed a cached failure");
  });

  // Callers arriving together share one request. The check and both assignments
  // in getAccessToken run synchronously before any await, which is what makes
  // that true — and it is what stops a batch of twenty concurrent sends opening
  // twenty token requests.
  test("concurrent senders share a single token request", async () => {
    const calls = stubFetch({
      token: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return jsonResponse({ access_token: "tok-123", expires_in: 3600 });
      },
    });

    await Promise.all([
      sendInvitationEmail(invitation),
      sendInvitationEmail(invitation),
      sendInvitationEmail(invitation),
    ]);

    assert.equal(tokenCount(calls), 1);
  });

  // `<= 1` rather than a fixed number, and that is deliberate. The token cache
  // is module state, so what this test starts with depends on what ran before
  // it: on its own it fetches once and reuses it, and after the test above it
  // inherits a live token and fetches none. Both satisfy the actual contract —
  // two sequential sends must not produce two token requests — and asserting a
  // fixed count would pin the execution order instead of the behaviour.
  test("a live token is reused rather than refetched", async () => {
    const calls = stubFetch({
      token: jsonResponse({ access_token: "tok-123", expires_in: 3600 }),
    });

    await sendInvitationEmail(invitation);
    await sendInvitationEmail(invitation);

    assert.ok(
      tokenCount(calls) <= 1,
      `two sends fetched ${tokenCount(calls)} tokens; a live one should be reused`,
    );
  });
});
