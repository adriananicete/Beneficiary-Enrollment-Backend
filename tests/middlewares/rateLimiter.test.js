import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  AUTH_IP_BURST,
  ENROLLMENT_BURST,
  enrollmentTokenKey,
  loginAttemptKey,
  passwordChangeKey,
  REFERENCE_BURST,
  REFERENCE_CALLS_PER_FORM,
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

// What express.json() hands over for {"toString": 1}. `${value}` throws on it:
// toString is not a function, and valueOf returns the object itself.
const CANNOT_BE_TEXT = JSON.parse('{"toString": 1}');

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

  // Not text, so not a token. A template literal throws on this one, and the
  // limiter answered 500 before the route ran.
  test("a token that is not text is treated as no token, without throwing", () => {
    for (const token of [CANNOT_BE_TEXT, 12345, ["a", "b"], { a: 1 }]) {
      const key = enrollmentTokenKey(makeReq({ body: { token }, ip: "203.0.113.7" }));

      assert.doesNotMatch(key, /^token:/, JSON.stringify(token));
      assert.match(key, /203\.0\.113\.7/);
    }
  });

  // A bad body token does not hide a good query token.
  test("a body token that is not text falls through to the query", () => {
    const key = enrollmentTokenKey(
      makeReq({ body: { token: CANNOT_BE_TEXT }, query: { token: TOKEN }, ip: "10.0.0.1" }),
    );

    assert.equal(key, `token:${TOKEN}`);
  });
});

describe("passwordChangeKey", () => {
  // What verifyResetToken leaves on the request.
  const changeReq = (username, ip, body = { oldPassword: "Temp1x", newPassword: "Pa$$w0rd" }) =>
    makeReq({ resetUser: { username, purpose: "password_reset" }, body, ip });

  // The defect. Under strictLimiter both of these keyed as "<ip>:unknown", so
  // one office shared ten changes per fifteen minutes.
  test("two employees changing passwords from one office are counted separately", () => {
    const first = passwordChangeKey(changeReq("EMP-020", "203.0.113.7"));
    const second = passwordChangeKey(changeReq("EMP-021", "203.0.113.7"));

    assert.notEqual(first, second);
    assert.equal(first, "reset:EMP-020");
  });

  test("one employee from two addresses is counted together", () => {
    assert.equal(
      passwordChangeKey(changeReq("EMP-020", "203.0.113.7")),
      passwordChangeKey(changeReq("EMP-020", "198.51.100.4")),
    );
  });

  // The username comes from the signed token, never from the body, so a
  // caller cannot move their attempts onto somebody else's budget.
  test("ignores a username in the body", () => {
    const key = passwordChangeKey(
      changeReq("EMP-020", "203.0.113.7", { username: "EMP-999", oldPassword: "x" }),
    );

    assert.equal(key, "reset:EMP-020");
  });

  // Unreachable on the routes, where verifyResetToken refuses first. Still
  // bounded rather than thrown if the order is ever changed.
  test("falls back to the address without a reset token", () => {
    const key = passwordChangeKey(makeReq({ ip: "203.0.113.7" }));

    assert.equal(key, "203.0.113.7");
  });
});

describe("loginAttemptKey", () => {
  test("counts an attempt against the address and the username together", () => {
    const key = loginAttemptKey(makeReq({ body: { username: "EMP-020" }, ip: "203.0.113.7" }));

    assert.equal(key, "203.0.113.7:EMP-020");
  });

  test("a missing username counts as unknown", () => {
    assert.equal(loginAttemptKey(makeReq({ ip: "203.0.113.7" })), "203.0.113.7:unknown");
  });

  // The login body is whatever JSON the caller sent.
  test("a username that is not text counts as unknown, without throwing", () => {
    for (const username of [CANNOT_BE_TEXT, 12345, ["a", "b"], { a: 1 }, ""])
      assert.equal(
        loginAttemptKey(makeReq({ body: { username }, ip: "203.0.113.7" })),
        "203.0.113.7:unknown",
        JSON.stringify(username),
      );
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

  // One form makes about six reference calls, one per dropdown. Fewer than
  // that per invited employee and the ceiling refuses an ordinary morning.
  test("the reference ceiling clears one dropdown call per field for a full upload", () => {
    assert.ok(
      REFERENCE_BURST >= MAX_INVITATION_EMAILS * 6,
      `${REFERENCE_BURST} cannot serve ${MAX_INVITATION_EMAILS} employees filling six dropdowns`,
    );
  });

  test("the reference ceiling is derived from the invitation cap", () => {
    assert.equal(REFERENCE_BURST, MAX_INVITATION_EMAILS * REFERENCE_CALLS_PER_FORM);
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
