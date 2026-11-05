import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import { AppError } from "../../src/utils/AppError.js";
import { ebamConfigured, fetchBookedList } from "../../src/integrations/ebamClient.js";

const KEY = "test-key-should-never-appear-anywhere";
const BASE = "https://gis-uat.example/api/ebam/external";

const original = { base: process.env.EBAM_BASE_URL, key: process.env.EBAM_API_KEY };
const restore = (name, value) => (value === undefined ? delete process.env[name] : (process.env[name] = value));

beforeEach(() => {
  process.env.EBAM_BASE_URL = BASE;
  process.env.EBAM_API_KEY = KEY;
});

afterEach(() => {
  restore("EBAM_BASE_URL", original.base);
  restore("EBAM_API_KEY", original.key);
});

const answering = (status, body) => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { status, ok: status >= 200 && status < 300, json: async () => (body instanceof Error ? Promise.reject(body) : body) };
  };

  return { fetchImpl, calls };
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
    const { fetchImpl, calls } = answering(200, { data: [] });

    await fetchBookedList({ page: 2, limit: 100, fetchImpl });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${BASE}/booked-list?page=2&limit=100`);
    assert.equal(calls[0].options.headers["x-api-key"], KEY);
    assert.equal(calls[0].url.includes(KEY), false, "not in the address");
  });

  test("defaults to the first page of 500, and a slash on the end of the base address does not double", async () => {
    process.env.EBAM_BASE_URL = `${BASE}///`;
    const { fetchImpl, calls } = answering(200, []);

    await fetchBookedList({ fetchImpl });

    assert.equal(calls[0].url, `${BASE}/booked-list?page=1&limit=500`);
  });

  test("answers what the other system sent", async () => {
    const body = { data: [{ anything: 1 }], total: 1 };

    assert.deepEqual(await fetchBookedList({ fetchImpl: answering(200, body).fetchImpl }), body);
  });

  test("is not set up without both settings, and says so with a 503 and not the key", async () => {
    for (const missing of ["EBAM_BASE_URL", "EBAM_API_KEY"]) {
      process.env.EBAM_BASE_URL = BASE;
      process.env.EBAM_API_KEY = KEY;
      process.env[missing] = "  ";

      assert.equal(ebamConfigured(), false, missing);
      const error = await refusal(fetchBookedList({ fetchImpl: answering(200, {}).fetchImpl }));

      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 503);
      assert.equal(error.message.includes(KEY), false);
    }
  });

  test("is configured when both are set", () => {
    assert.equal(ebamConfigured(), true);
  });

  test("page and limit are checked before anything is sent", async () => {
    const { fetchImpl, calls } = answering(200, {});

    for (const options of [{ page: 0 }, { page: 1.5 }, { page: "1" }, { limit: 0 }, { limit: 501 }, { limit: "5" }]) {
      const error = await refusal(fetchBookedList({ ...options, fetchImpl }));

      assert.equal(error.statusCode, 400, JSON.stringify(options));
    }
    assert.equal(calls.length, 0);
  });

  test("a refused key is 502 with its own sentence, and any other failure is 502 too", async () => {
    for (const status of [401, 403]) assert.match((await refusal(fetchBookedList({ fetchImpl: answering(status, {}).fetchImpl }))).message, /refused the key/);

    const failed = await refusal(fetchBookedList({ fetchImpl: answering(500, {}).fetchImpl }));
    assert.equal(failed.statusCode, 502);
    assert.match(failed.message, /answered 500/);
  });

  test("a call that cannot be made, or takes too long, says so without the address or the key", async () => {
    const unreachable = await refusal(fetchBookedList({ fetchImpl: async () => { throw Object.assign(new Error(`connect ECONNREFUSED ${BASE} with ${KEY}`), { name: "TypeError" }); } }));
    const slow = await refusal(fetchBookedList({ fetchImpl: async () => { throw Object.assign(new Error("timed out"), { name: "TimeoutError" }); } }));

    assert.equal(unreachable.statusCode, 502);
    assert.match(unreachable.message, /could not be reached/);
    assert.equal(unreachable.message.includes(BASE) || unreachable.message.includes(KEY), false);
    assert.match(slow.message, /did not answer in time/);
  });

  test("an answer that is not JSON is 502", async () => {
    const error = await refusal(fetchBookedList({ fetchImpl: answering(200, new SyntaxError("Unexpected token")).fetchImpl }));

    assert.equal(error.statusCode, 502);
    assert.match(error.message, /not JSON/);
  });
});
