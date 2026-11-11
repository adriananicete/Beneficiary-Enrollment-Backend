import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import {
  createIpsAccess,
  IPS_ADDRESS_REFUSED,
  IPS_KEY_REQUIRED,
  IPS_OFF,
} from "../../src/middlewares/ipsAccess.js";
import { hashKey, newKey } from "../../src/utils/integrationKeys.js";
import { makeNext, makeReq, makeRes } from "../helpers/http.js";

// The door for IPS (md/IPS-INTEGRATION-DECISIONS.md). The order of the pieces on each route is
// held by tests/routes/ipsRoutes.test.js; each piece is held here.

const KEY = newKey();
const KEY_HASH = hashKey(KEY);

const withKey = (key, overrides = {}) => makeReq({ headers: key === undefined ? {} : { "x-api-key": key }, ip: "10.0.0.5", ...overrides });

describe("enabled", () => {
  test("with no key hash set, every call is 404, as if the API were not there", () => {
    const next = makeNext();
    createIpsAccess({ keyHashes: [] }).enabled(withKey(KEY), makeRes(), next);

    assert.deepEqual(next.refusal(), { statusCode: 404, message: IPS_OFF });
  });

  test("with one set, the call goes on", () => {
    const next = makeNext();
    createIpsAccess({ keyHashes: [KEY_HASH] }).enabled(withKey(KEY), makeRes(), next);

    assert.ok(next.passed());
  });
});

describe("requireKey", () => {
  const { requireKey } = createIpsAccess({ keyHashes: [KEY_HASH] });

  test("the right key passes, and the request carries the key's id, not the key", () => {
    const req = withKey(KEY);
    const next = makeNext();
    requireKey(req, makeRes(), next);

    assert.ok(next.passed());
    assert.equal(req.ipsKeyId, KEY_HASH.slice(0, 8));
  });

  test("a missing key and a wrong one get the same 401", () => {
    for (const key of [undefined, "", "wrong", `${KEY} `, KEY_HASH]) {
      const req = withKey(key);
      const next = makeNext();
      requireKey(req, makeRes(), next);

      assert.deepEqual(next.refusal(), { statusCode: 401, message: IPS_KEY_REQUIRED }, String(key));
      assert.equal(req.ipsKeyId, undefined);
    }
  });

  test("the key is read from x-api-key only, not from the query or the body", () => {
    const next = makeNext();
    requireKey(withKey(undefined, { query: { "x-api-key": KEY }, body: { "x-api-key": KEY } }), makeRes(), next);

    assert.equal(next.refusal()?.statusCode, 401);
  });
});

describe("allowedSource", () => {
  test("with no addresses set, any address goes on", () => {
    const next = makeNext();
    createIpsAccess({ keyHashes: [KEY_HASH] }).allowedSource(withKey(KEY, { ip: "203.0.113.9" }), makeRes(), next);

    assert.ok(next.passed());
  });

  test("with addresses set, only those go on, an IPv4 caller on a dual-stack socket included", () => {
    const { allowedSource } = createIpsAccess({ keyHashes: [KEY_HASH], allowedAddresses: ["10.0.0.5"] });

    for (const ip of ["10.0.0.5", "::ffff:10.0.0.5"]) {
      const next = makeNext();
      allowedSource(withKey(KEY, { ip }), makeRes(), next);
      assert.ok(next.passed(), ip);
    }

    for (const ip of ["10.0.0.6", "::ffff:10.0.0.6", "::1", undefined]) {
      const next = makeNext();
      allowedSource(withKey(KEY, { ip }), makeRes(), next);
      assert.deepEqual(next.refusal(), { statusCode: 403, message: IPS_ADDRESS_REFUSED }, String(ip));
    }
  });
});

describe("noStore", () => {
  test("every answer says not to keep a copy", () => {
    const res = makeRes();
    const next = makeNext();
    createIpsAccess().noStore(withKey(KEY), res, next);

    assert.equal(res.headers["Cache-Control"], "no-store");
    assert.ok(next.passed());
  });
});

describe("callLog", () => {
  const finished = (req, { statusCode = 200, locals = {} } = {}) => {
    const lines = [];
    const res = Object.assign(new EventEmitter(), { statusCode, locals });
    const next = makeNext();

    createIpsAccess({ keyHashes: [KEY_HASH], log: (line) => lines.push(line) }).callLog(req, res, next);
    assert.ok(next.passed());
    assert.deepEqual(lines, [], "nothing is written before the answer has gone");

    res.emit("finish");
    return lines;
  };

  test("one line when the answer has gone: route, status, key id, address and rows", () => {
    const req = withKey(KEY, { method: "GET", baseUrl: "/api/v1/integration/ips", path: "/companies", ip: "::ffff:10.0.0.5", ipsKeyId: "ab12cd34" });
    const [line, ...more] = finished(req, { locals: { ipsRows: 12 } });

    assert.deepEqual(more, []);
    assert.match(line, /^\[ips\] GET \/api\/v1\/integration\/ips\/companies status=200 key=ab12cd34 from=10\.0\.0\.5 rows=12 ms=\d+$/);
  });

  test("a refused call is logged too, with no key id and no rows", () => {
    const req = withKey("a guess", { method: "GET", baseUrl: "/api/v1/integration/ips", path: "/companies" });
    const [line] = finished(req, { statusCode: 401 });

    assert.match(line, /status=401 key=none from=10\.0\.0\.5 rows=- /);
  });

  test("the key, the query and the body never reach the log", () => {
    const req = withKey(KEY, {
      method: "GET",
      baseUrl: "/api/v1/integration/ips",
      path: "/companies",
      originalUrl: "/api/v1/integration/ips/companies?search=Juan",
      query: { search: "Juan" },
      body: { secret: "Juan" },
    });
    const [line] = finished(req);

    assert.ok(!line.includes(KEY));
    assert.ok(!line.includes("Juan"));
  });
});
