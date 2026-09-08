import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  AUTH_IP_BURST,
  ENROLLMENT_BURST,
  enrollmentTokenKey,
} from "../../src/middlewares/rateLimiter.js";
import { MAX_INVITATION_EMAILS } from "../../src/utils/partitionEmails.js";
import { makeReq } from "../helpers/http.js";

// The limiters themselves are objects built at import and are not worth
// asserting. The key generator is different: it decides WHO a request counts
// against, and getting that wrong is how a rate limit refuses the wrong people.
//
// That is not hypothetical here. Both public enrollment routes were keyed on
// the IP, and an employee enrols from their company's office — so a whole
// company shared one bucket. Two hundred invitations sent on a Monday would
// have started failing at the twenty-first person, with a message about
// something they had done once.

const TOKEN = "a".repeat(64);

describe("enrollmentTokenKey", () => {
  // The token is the per-employee identity on a public route, the same role
  // user_id plays on the authenticated ones.
  test("counts a submit against its invitation, not its address", () => {
    const key = enrollmentTokenKey(makeReq({ body: { token: TOKEN }, ip: "10.0.0.1" }));

    assert.equal(key, `token:${TOKEN}`);
    assert.doesNotMatch(key, /10\.0\.0\.1/);
  });

  // The lookup carries it in the query rather than the body, and both routes
  // share this generator.
  test("finds the token in the query as well as the body", () => {
    const key = enrollmentTokenKey(makeReq({ query: { token: TOKEN }, ip: "10.0.0.1" }));

    assert.equal(key, `token:${TOKEN}`);
  });

  // The whole point. Two people behind one office address, each with their own
  // invitation, must not share a bucket.
  test("two invitations from one address are counted separately", () => {
    const ip = "203.0.113.7";

    const first = enrollmentTokenKey(makeReq({ body: { token: "a".repeat(64) }, ip }));
    const second = enrollmentTokenKey(makeReq({ body: { token: "b".repeat(64) }, ip }));

    assert.notEqual(first, second);
  });

  // And the converse: one invitation used from two places is still one bucket,
  // which is what stops a forwarded link being hammered from several machines.
  test("one invitation from two addresses is counted together", () => {
    const first = enrollmentTokenKey(makeReq({ body: { token: TOKEN }, ip: "203.0.113.7" }));
    const second = enrollmentTokenKey(makeReq({ body: { token: TOKEN }, ip: "198.51.100.4" }));

    assert.equal(first, second);
  });

  // No token is a malformed request, and it falls back to the address so that
  // such requests are still bounded. Keying on the token ALONE would let a
  // caller sending random tokens open a fresh bucket every time — unlimited
  // traffic and an unbounded store. mediumLimiter is stacked in front for the
  // same reason.
  test("falls back to the address when there is no token", () => {
    const key = enrollmentTokenKey(makeReq({ ip: "203.0.113.7" }));

    assert.doesNotMatch(key, /^token:/);
    assert.match(key, /203\.0\.113\.7/);
  });

  test("an empty token is treated as no token", () => {
    const key = enrollmentTokenKey(makeReq({ body: { token: "" }, ip: "203.0.113.7" }));

    assert.doesNotMatch(key, /^token:/);
  });
});

// A limiter object does not expose its own ceiling, so what is asserted is the
// relationship the ceilings were derived from — which is the part that can go
// quietly wrong. Both numbers were guessed twice before they were measured
// against anything, and both were too small.
describe("the IP ceilings are sized from the largest burst the system can create", () => {
  // HR can create MAX_INVITATION_EMAILS invitations in one action, and every
  // one of those people may enrol the same day from the same office. A ceiling
  // below that refuses the system's own maximum.
  test("the enrollment ceiling clears one full invitation upload", () => {
    assert.ok(
      ENROLLMENT_BURST >= MAX_INVITATION_EMAILS,
      `${ENROLLMENT_BURST} would refuse an upload of ${MAX_INVITATION_EMAILS} before it finished enrolling`,
    );
  });

  // Each employee costs at least two requests against the shared enrollment
  // limiter — the lookup when they open the link, and the submit — before any
  // refresh or any submission refused by validation.
  test("and leaves room for the lookup as well as the submit", () => {
    assert.ok(ENROLLMENT_BURST >= MAX_INVITATION_EMAILS * 2);
  });

  // Fifteen-minute window, so four of them to the hour.
  test("a company's worth of first logins fits inside an hour", () => {
    assert.ok(
      AUTH_IP_BURST * 4 >= MAX_INVITATION_EMAILS,
      `${AUTH_IP_BURST} per 15 minutes cannot absorb ${MAX_INVITATION_EMAILS} logins in an hour`,
    );
  });

  // The point of deriving them. If the invitation cap moves and these do not,
  // the arithmetic above catches it rather than a blocked employee doing so.
  test("both are derived from the invitation cap rather than fixed", () => {
    assert.equal(ENROLLMENT_BURST % MAX_INVITATION_EMAILS, 0);
    assert.equal(MAX_INVITATION_EMAILS % AUTH_IP_BURST, 0);
  });
});
