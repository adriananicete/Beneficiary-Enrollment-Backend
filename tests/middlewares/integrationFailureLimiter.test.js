import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";
import { makeNext, makeReq } from "../helpers/http.js";

const { FAILURE_LIMIT, FAILURE_WINDOW_MS, createFailureLimiter } = await import(
  "../../src/middlewares/integrationFailureLimiter.js"
);

// Failed authentications per source address (docs/claims-details/CONTRACT.md, "Slowing guesses"):
// 20 in 15 minutes, then 429 for the rest of the window.

const MINUTE = 60 * 1000;

// A clock the test moves.
const clock = (start = 1_000_000) => {
  let time = start;
  const now = () => time;
  now.advance = (milliseconds) => {
    time += milliseconds;
  };
  return now;
};

// What the router does with a request: the limiter first, then the key check, which counts a refused
// key (a 401) at the moment it refuses it. `status` is the answer's. Nothing here waits for a
// response to finish: there is no response object that could.
const attempt = (limiter, ip, status) => {
  const req = makeReq({ ip });
  const headers = {};
  const res = {
    setHeader: (name, value) => {
      headers[name] = value;
    },
  };
  const next = makeNext();

  limiter(req, res, next);

  if (!next.passed()) return { refusal: next.refusal(), headers };

  if (status === 401) limiter.count(req);

  return { refusal: null, headers };
};

const fail = (limiter, ip) => attempt(limiter, ip, 401);

describe("the failed-attempt limiter", () => {
  test("the documented numbers are 20 in 15 minutes", () => {
    assert.equal(FAILURE_LIMIT, 20);
    assert.equal(FAILURE_WINDOW_MS, 15 * MINUTE);
  });

  test("lets twenty failures through to be answered 401, and refuses the next with 429", () => {
    const limiter = createFailureLimiter({ now: clock() });

    for (let count = 1; count <= 20; count++) assert.equal(fail(limiter, "10.1.2.3").refusal, null, `failure ${count}`);

    const refused = attempt(limiter, "10.1.2.3", 200);
    assert.equal(refused.refusal.statusCode, 429);
    assert.match(refused.refusal.message, /Too many failed attempts/);
  });

  // The lockout comes before the key is looked at.
  test("a locked-out source is refused even for a call that would have succeeded", () => {
    const limiter = createFailureLimiter({ now: clock() });
    for (let count = 0; count < 20; count++) fail(limiter, "10.1.2.3");

    assert.equal(attempt(limiter, "10.1.2.3", 200).refusal.statusCode, 429);
    assert.equal(attempt(limiter, "10.1.2.3", 200).refusal.statusCode, 429, "and stays refused");
  });

  test("tells the caller how long is left", () => {
    const now = clock();
    const limiter = createFailureLimiter({ now });
    for (let count = 0; count < 20; count++) fail(limiter, "10.1.2.3");

    now.advance(5 * MINUTE);

    assert.equal(attempt(limiter, "10.1.2.3", 200).headers["Retry-After"], 10 * 60);
  });

  // Requests pipelined down one connection are all handled before the first answer is written. A
  // count made when the answer finished let every one of them through.
  test("a failure is counted the moment it is decided, before any answer exists", () => {
    const limiter = createFailureLimiter({ now: clock() });
    const refused = [];

    // No answer is ever finished in this loop: only the key check's count().
    for (let index = 0; index < 200; index++) {
      const next = makeNext();
      const req = makeReq({ ip: "10.1.2.3" });

      limiter(req, { setHeader() {} }, next);
      if (next.passed()) limiter.count(req);
      else refused.push(next.refusal().statusCode);
    }

    assert.equal(refused.length, 180);
    assert.ok(refused.every((status) => status === 429));
  });

  test("good calls between failures do not reset the count", () => {
    const limiter = createFailureLimiter({ now: clock() });

    for (let count = 0; count < 20; count++) {
      fail(limiter, "10.1.2.3");
      attempt(limiter, "10.1.2.3", 200);
    }

    assert.equal(attempt(limiter, "10.1.2.3", 200).refusal.statusCode, 429);
  });

  test("each source address has its own count", () => {
    const limiter = createFailureLimiter({ now: clock() });
    for (let count = 0; count < 20; count++) fail(limiter, "10.1.2.3");

    assert.equal(attempt(limiter, "10.1.2.3", 200).refusal.statusCode, 429);
    assert.equal(attempt(limiter, "10.1.2.4", 200).refusal, null);
    assert.equal(fail(limiter, "10.1.2.4").refusal, null);
  });

  test("an IPv4 address written as IPv6 is the same source", () => {
    const limiter = createFailureLimiter({ now: clock() });
    for (let count = 0; count < 10; count++) fail(limiter, "10.1.2.3");
    for (let count = 0; count < 10; count++) fail(limiter, "::ffff:10.1.2.3");

    assert.equal(attempt(limiter, "10.1.2.3", 200).refusal.statusCode, 429);
  });

  test("the window ends fifteen minutes after the first failure, and the count starts again", () => {
    const now = clock();
    const limiter = createFailureLimiter({ now });
    for (let count = 0; count < 20; count++) fail(limiter, "10.1.2.3");

    now.advance(15 * MINUTE - 1);
    assert.equal(attempt(limiter, "10.1.2.3", 200).refusal.statusCode, 429, "the last millisecond of the window");

    now.advance(1);
    assert.equal(attempt(limiter, "10.1.2.3", 200).refusal, null, "the window is over");

    for (let count = 0; count < 20; count++) assert.equal(fail(limiter, "10.1.2.3").refusal, null);
    assert.equal(fail(limiter, "10.1.2.3").refusal.statusCode, 429);
  });

  test("the window runs from the first failure, not from the latest", () => {
    const now = clock();
    const limiter = createFailureLimiter({ now });

    fail(limiter, "10.1.2.3");
    now.advance(14 * MINUTE);
    for (let count = 0; count < 19; count++) fail(limiter, "10.1.2.3");
    assert.equal(attempt(limiter, "10.1.2.3", 200).refusal.statusCode, 429);

    now.advance(MINUTE);
    assert.equal(attempt(limiter, "10.1.2.3", 200).refusal, null);
  });

  test("a failure after the window opens a new one", () => {
    const now = clock();
    const limiter = createFailureLimiter({ now });
    for (let count = 0; count < 19; count++) fail(limiter, "10.1.2.3");

    now.advance(16 * MINUTE);
    for (let count = 0; count < 20; count++) assert.equal(fail(limiter, "10.1.2.3").refusal, null);
  });

  test("reset forgets every count", () => {
    const limiter = createFailureLimiter({ now: clock() });
    for (let count = 0; count < 20; count++) fail(limiter, "10.1.2.3");

    limiter.reset();

    assert.equal(attempt(limiter, "10.1.2.3", 200).refusal, null);
  });

  test("the limit and the window can be set", () => {
    const now = clock();
    const limiter = createFailureLimiter({ limit: 2, windowMs: MINUTE, now });

    fail(limiter, "10.1.2.3");
    fail(limiter, "10.1.2.3");
    assert.equal(attempt(limiter, "10.1.2.3", 200).refusal.statusCode, 429);

    now.advance(MINUTE);
    assert.equal(attempt(limiter, "10.1.2.3", 200).refusal, null);
  });

  test("an address that is not there is one source, not none", () => {
    const limiter = createFailureLimiter({ now: clock() });
    for (let count = 0; count < 20; count++) fail(limiter, undefined);

    assert.equal(attempt(limiter, undefined, 200).refusal.statusCode, 429);
  });
});
