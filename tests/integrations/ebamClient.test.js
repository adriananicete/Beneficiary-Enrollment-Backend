import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { AppError } from "../../src/utils/AppError.js";
import { ebamConfigured, fetchBookedList } from "../../src/integrations/ebamClient.js";

const KEY = "test-key-should-never-appear-anywhere";
const BASE = "https://gis-uat.phillife.com.ph/api/ebam/external";

const original = { base: process.env.EBAM_BASE_URL, key: process.env.EBAM_API_KEY, tls: process.env.NODE_TLS_REJECT_UNAUTHORIZED };
const restore = (name, value) => (value === undefined ? delete process.env[name] : (process.env[name] = value));

beforeEach(() => {
  process.env.EBAM_BASE_URL = BASE;
  process.env.EBAM_API_KEY = KEY;
});

afterEach(() => {
  restore("EBAM_BASE_URL", original.base);
  restore("EBAM_API_KEY", original.key);
  restore("NODE_TLS_REJECT_UNAUTHORIZED", original.tls);
});

// A stand-in for https.request: records the call, then answers with `status` and `body` (text as it is, anything else as JSON).
// `silent` never answers, for a call that takes too long.
const answering = (status, body, { silent = false } = {}) => {
  const calls = [];
  const requestImpl = (url, options, onResponse) => {
    calls.push({ url, options });

    const request = new EventEmitter();
    request.destroy = (error) => request.emit("error", error);
    request.end = () => {
      if (silent) return;

      const response = new EventEmitter();
      response.statusCode = status;
      response.destroy = () => {};
      onResponse(response);
      response.emit("data", Buffer.from(typeof body === "string" ? body : JSON.stringify(body)));
      response.emit("end");
    };

    return request;
  };

  return { requestImpl, calls };
};

const failing = (error) => () => {
  const request = new EventEmitter();
  request.destroy = () => {};
  request.end = () => request.emit("error", error);

  return request;
};

const refusal = async (promise) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return assert.fail("it was not refused");
};

describe("the booked companies list", () => {
  test("is asked for with the key in the x-api-key header and nowhere else", async () => {
    const { requestImpl, calls } = answering(200, { data: [] });

    await fetchBookedList({ page: 2, limit: 100, requestImpl });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${BASE}/booked-list?page=2&limit=100`);
    assert.equal(calls[0].options.method, "GET");
    assert.equal(calls[0].options.headers["x-api-key"], KEY);
    assert.equal(calls[0].url.includes(KEY), false, "not in the address");
  });

  test("defaults to the first page of 500, and a slash on the end of the base address does not double", async () => {
    process.env.EBAM_BASE_URL = `${BASE}///`;
    const { requestImpl, calls } = answering(200, []);

    await fetchBookedList({ requestImpl });

    assert.equal(calls[0].url, `${BASE}/booked-list?page=1&limit=500`);
  });

  test("answers what the other system sent", async () => {
    const body = { data: [{ anything: 1 }], total: 1 };

    assert.deepEqual(await fetchBookedList({ requestImpl: answering(200, body).requestImpl }), body);
  });

  test("is not set up without both settings, and says so with a 503 and not the key", async () => {
    for (const missing of ["EBAM_BASE_URL", "EBAM_API_KEY"]) {
      process.env.EBAM_BASE_URL = BASE;
      process.env.EBAM_API_KEY = KEY;
      process.env[missing] = "  ";

      assert.equal(ebamConfigured(), false, missing);
      const error = await refusal(fetchBookedList({ requestImpl: answering(200, {}).requestImpl }));

      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 503);
      assert.equal(error.message.includes(KEY), false);
    }
  });

  test("is configured when both are set", () => {
    assert.equal(ebamConfigured(), true);
  });

  test("page and limit are checked before anything is sent", async () => {
    const { requestImpl, calls } = answering(200, {});

    for (const options of [{ page: 0 }, { page: 1.5 }, { page: "1" }, { limit: 0 }, { limit: 501 }, { limit: "5" }]) {
      const error = await refusal(fetchBookedList({ ...options, requestImpl }));

      assert.equal(error.statusCode, 400, JSON.stringify(options));
    }
    assert.equal(calls.length, 0);
  });

  test("a refused key is 502 with its own sentence, and any other failure is 502 too", async () => {
    for (const status of [401, 403]) assert.match((await refusal(fetchBookedList({ requestImpl: answering(status, {}).requestImpl }))).message, /refused the key/);

    const failed = await refusal(fetchBookedList({ requestImpl: answering(500, {}).requestImpl }));
    assert.equal(failed.statusCode, 502);
    assert.match(failed.message, /answered 500/);
  });

  test("a call that cannot be made, or takes too long, says so without the address or the key", async () => {
    const unreachable = await refusal(fetchBookedList({ requestImpl: failing(Object.assign(new Error(`connect ECONNREFUSED ${BASE} with ${KEY}`), { code: "ECONNREFUSED" })) }));
    const slow = await refusal(fetchBookedList({ requestImpl: answering(200, {}, { silent: true }).requestImpl, timeoutMs: 20 }));

    assert.equal(unreachable.statusCode, 502);
    assert.match(unreachable.message, /could not be reached/);
    assert.equal(unreachable.message.includes(BASE) || unreachable.message.includes(KEY), false);
    assert.equal(slow.statusCode, 502);
    assert.match(slow.message, /did not answer in time/);
  });

  test("an answer that is not JSON is 502", async () => {
    const error = await refusal(fetchBookedList({ requestImpl: answering(200, "<html>Bad gateway</html>").requestImpl }));

    assert.equal(error.statusCode, 502);
    assert.match(error.message, /not JSON/);
  });
});

describe("what keeps the key where it belongs", () => {
  test("an address that is not https, not under phillife.com.ph, or that carries a login is refused before anything is sent", async () => {
    const { requestImpl, calls } = answering(200, {});
    const addresses = [
      "http://gis-uat.phillife.com.ph/api/ebam/external",
      "https://gis-uat.example/api/ebam/external",
      "https://phillife.com.ph.example/api/ebam/external",
      "https://notphillife.com.ph/api/ebam/external",
      "https://user:pass@gis-uat.phillife.com.ph/api/ebam/external",
      "gis-uat.phillife.com.ph/api/ebam/external",
    ];

    for (const address of addresses) {
      process.env.EBAM_BASE_URL = address;
      const error = await refusal(fetchBookedList({ requestImpl }));

      assert.equal(error.statusCode, 503, address);
      assert.equal(error.message.includes(KEY), false, address);
    }
    assert.equal(calls.length, 0);
  });

  test("phillife.com.ph itself and any host under it are allowed", async () => {
    for (const host of ["phillife.com.ph", "gis.phillife.com.ph", "a.b.PhilLife.com.ph"]) {
      process.env.EBAM_BASE_URL = `https://${host}/api/ebam/external`;
      const { requestImpl, calls } = answering(200, {});

      await fetchBookedList({ requestImpl });

      assert.equal(calls.length, 1, host);
    }
  });

  test("the certificate is checked whatever NODE_TLS_REJECT_UNAUTHORIZED says", async () => {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    const { requestImpl, calls } = answering(200, {});

    await fetchBookedList({ requestImpl });

    assert.equal(calls[0].options.rejectUnauthorized, true);
  });

  test("a redirect is not followed: it is a 502, and the key goes nowhere else", async () => {
    for (const status of [301, 302, 307, 308]) {
      const { requestImpl, calls } = answering(status, "");
      const error = await refusal(fetchBookedList({ requestImpl }));

      assert.equal(error.statusCode, 502, String(status));
      assert.match(error.message, new RegExp(`answered ${status}`));
      assert.equal(calls.length, 1, "asked once, never again at the new address");
    }
  });

  test("an answer larger than the limit is refused", async () => {
    const error = await refusal(fetchBookedList({ requestImpl: answering(200, "x".repeat(50)).requestImpl, maxBytes: 10 }));

    assert.equal(error.statusCode, 502);
    assert.match(error.message, /too large/);
  });
});
