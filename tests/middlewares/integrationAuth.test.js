import { afterEach, beforeEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import "../helpers/env.js";
import { makeNext, makeReq } from "../helpers/http.js";
import { BOTH_SCOPES, FAR_FUTURE, entry, setting, sha256 } from "../helpers/integrationKeys.js";

const { describeKeys, expiryOf, integrationAuth, parseKeyHashes, requireScope } = await import(
  "../../src/middlewares/integrationAuth.js"
);

// The claims web app's key (docs/claims-details/CONTRACT.md, "Authentication" and "Keys, with scopes
// and expiry"). The server holds only SHA-256 hashes, so the keys below are written here and their
// hashes are what the environment gets.
const KEY = "claims-web-test-key-0001";
const OTHER_KEY = "claims-web-test-key-0002";

const HASHES = setting(entry("claimsweb", KEY), entry("backup", OTHER_KEY, { scopes: "claims:read" }));

const REFUSAL = { statusCode: 401, message: "Unauthorized: a valid API key is required." };

const call = (headers) => {
  const req = makeReq({ headers });
  const next = makeNext();

  integrationAuth(req, {}, next);

  return { req, next };
};

let saved;
let logged;
let restoreLogs;

beforeEach(() => {
  saved = process.env.INTEGRATION_API_KEY_HASHES;
  process.env.INTEGRATION_API_KEY_HASHES = HASHES;

  // Anything the middleware writes to the console, so a test can look for a key in it.
  logged = [];
  const capture = (...args) => logged.push(args.join(" "));
  const log = console.log;
  const error = console.error;
  console.log = capture;
  console.error = capture;
  restoreLogs = () => {
    console.log = log;
    console.error = error;
  };
});

afterEach(() => {
  if (saved === undefined) delete process.env.INTEGRATION_API_KEY_HASHES;
  else process.env.INTEGRATION_API_KEY_HASHES = saved;

  restoreLogs();
  mock.timers.reset();
  mock.restoreAll();
});

describe("integrationAuth: a valid key", () => {
  test("passes, and says which key it was and what it may do", () => {
    const { req, next } = call({ "x-api-key": KEY });

    assert.equal(next.passed(), true);
    assert.deepEqual(req.integration, { name: "claimsweb", scopes: ["claims:read", "claims:transfer"] });
  });

  test("each held key is its own name and its own scopes", () => {
    assert.deepEqual(call({ "x-api-key": OTHER_KEY }).req.integration, { name: "backup", scopes: ["claims:read"] });
  });

  test("a key is revoked by taking its entry out", () => {
    process.env.INTEGRATION_API_KEY_HASHES = entry("backup", OTHER_KEY);

    assert.deepEqual(call({ "x-api-key": KEY }).next.refusal(), REFUSAL);
    assert.equal(call({ "x-api-key": OTHER_KEY }).next.passed(), true);
  });

  test("the key is never written to the console", () => {
    call({ "x-api-key": KEY });
    call({ "x-api-key": "not-a-key-but-secret-looking" });

    assert.deepEqual(logged, []);
  });

  // A new key is added before the old one is removed.
  test("two entries with one name both work, so a key can be rotated", () => {
    process.env.INTEGRATION_API_KEY_HASHES = setting(entry("claimsweb", KEY), entry("claimsweb", OTHER_KEY));

    assert.deepEqual(call({ "x-api-key": KEY }).req.integration.name, "claimsweb");
    assert.deepEqual(call({ "x-api-key": OTHER_KEY }).req.integration.name, "claimsweb");
  });
});

describe("integrationAuth: a key that is refused", () => {
  const CASES = {
    "missing": {},
    "empty": { "x-api-key": "" },
    "unknown": { "x-api-key": "claims-web-test-key-9999" },
    "the right key with a letter changed": { "x-api-key": `${KEY.slice(0, -1)}x` },
    "the right key with a space after it": { "x-api-key": `${KEY} ` },
    "the hash instead of the key": { "x-api-key": sha256(KEY) },
    "one with a space inside": { "x-api-key": "two words" },
    "one with a control character": { "x-api-key": "key\u0001" },
    "longer than any real key": { "x-api-key": "k".repeat(257) },
    "sent twice": { "x-api-key": [KEY, KEY] },
    "not text": { "x-api-key": 12345 },
  };

  for (const [name, headers] of Object.entries(CASES))
    test(`${name} is 401`, () => {
      const { req, next } = call(headers);

      assert.deepEqual(next.refusal(), REFUSAL);
      assert.equal(req.integration, undefined);
    });

  // A caller learns nothing about which it was: one message for all of them, an expired key too.
  test("every refusal says exactly the same thing, an expired key included", () => {
    process.env.INTEGRATION_API_KEY_HASHES = entry("old", OTHER_KEY, { expires: "2020-01-01" });

    const messages = new Set([
      ...Object.values(CASES).map((headers) => call(headers).next.refusal().message),
      call({ "x-api-key": OTHER_KEY }).next.refusal().message,
    ]);

    assert.equal(messages.size, 1);
  });

  test("the refusal does not echo the key it was given", () => {
    const { next } = call({ "x-api-key": "claims-web-test-key-9999" });

    assert.doesNotMatch(next.refusal().message, /9999/);
  });

  test("a request with no headers object is refused, not an error", () => {
    const next = makeNext();

    integrationAuth({ body: {} }, {}, next);

    assert.deepEqual(next.refusal(), REFUSAL);
  });
});

describe("integrationAuth: expiry", () => {
  const withKeyExpiring = (expires) => {
    process.env.INTEGRATION_API_KEY_HASHES = entry("claimsweb", KEY, { expires });
  };

  const at = (iso) => {
    mock.timers.reset();
    mock.timers.enable({ apis: ["Date"], now: new Date(iso) });
  };

  test("a key is good through the last moment of its day in UTC", () => {
    withKeyExpiring("2027-06-30");

    at("2027-06-29T00:00:00.000Z");
    assert.equal(call({ "x-api-key": KEY }).next.passed(), true);

    at("2027-06-30T00:00:00.000Z");
    assert.equal(call({ "x-api-key": KEY }).next.passed(), true, "the first moment of the day");

    at("2027-06-30T23:59:59.999Z");
    assert.equal(call({ "x-api-key": KEY }).next.passed(), true, "the last moment of the day");
  });

  test("a key is refused from the first moment after its day, with the answer of an unknown key", () => {
    withKeyExpiring("2027-06-30");

    at("2027-07-01T00:00:00.000Z");
    assert.deepEqual(call({ "x-api-key": KEY }).next.refusal(), REFUSAL);

    at("2030-01-01T00:00:00.000Z");
    assert.deepEqual(call({ "x-api-key": KEY }).next.refusal(), REFUSAL);
  });

  // The day is a UTC day: in Manila it ends at 08:00 the next morning.
  test("the day ends at midnight UTC, not at midnight here", () => {
    withKeyExpiring("2027-06-30");

    at("2027-06-30T16:30:00.000Z"); // 00:30 on 1 July in Manila
    assert.equal(call({ "x-api-key": KEY }).next.passed(), true);
  });

  test("an expired entry does not stop a newer one of the same name", () => {
    process.env.INTEGRATION_API_KEY_HASHES = setting(
      entry("claimsweb", KEY, { expires: "2020-01-01" }),
      entry("claimsweb", OTHER_KEY),
    );

    assert.deepEqual(call({ "x-api-key": KEY }).next.refusal(), REFUSAL);
    assert.equal(call({ "x-api-key": OTHER_KEY }).next.passed(), true);
  });

  test("an expired key is still compared, so it takes as long as any other", () => {
    process.env.INTEGRATION_API_KEY_HASHES = setting(entry("old", KEY, { expires: "2020-01-01" }), entry("new", OTHER_KEY));
    const compare = mock.method(crypto, "timingSafeEqual");

    call({ "x-api-key": KEY });

    assert.equal(compare.mock.callCount(), 2);
  });
});

describe("requireScope", () => {
  const check = (scope, integration) => {
    const next = makeNext();

    requireScope(scope)({ integration }, {}, next);

    return next;
  };

  test("lets a key through that has the scope", () => {
    assert.equal(check("claims:read", { name: "claimsweb", scopes: ["claims:read"] }).passed(), true);
    assert.equal(check("claims:transfer", { name: "claimsweb", scopes: ["claims:read", "claims:transfer"] }).passed(), true);
  });

  test("a known key without the scope is 403, and the answer says which scope", () => {
    const refusal = check("claims:transfer", { name: "backup", scopes: ["claims:read"] }).refusal();

    assert.equal(refusal.statusCode, 403);
    assert.match(refusal.message, /claims:transfer/);
  });

  test("a request that has no key at all is refused too", () => {
    assert.equal(check("claims:read", undefined).refusal().statusCode, 403);
  });

  test("one scope does not stand for the other", () => {
    assert.equal(check("claims:read", { name: "x", scopes: ["claims:transfer"] }).refusal().statusCode, 403);
  });
});

describe("integrationAuth: when no key is held", () => {
  test("nothing configured refuses every call", () => {
    for (const value of [undefined, "", "   "]) {
      if (value === undefined) delete process.env.INTEGRATION_API_KEY_HASHES;
      else process.env.INTEGRATION_API_KEY_HASHES = value;

      assert.deepEqual(call({ "x-api-key": KEY }).next.refusal(), REFUSAL, JSON.stringify(value));
    }
  });

  // Failing closed: one mistyped entry must not leave the others, or none, answering.
  test("a malformed setting refuses every call, and says which entry without quoting it", () => {
    process.env.INTEGRATION_API_KEY_HASHES = `${entry("claimsweb", KEY)},backup:not-a-hash-at-all:claims:read:2099-12-31`;

    assert.deepEqual(call({ "x-api-key": KEY }).next.refusal(), REFUSAL);
    assert.ok(logged.some((line) => /entry 2/.test(line)));
    assert.ok(logged.every((line) => !line.includes("not-a-hash-at-all")));
  });

  test("the old name:hash form is malformed: scopes and a date are required", () => {
    process.env.INTEGRATION_API_KEY_HASHES = `claimsweb:${sha256(KEY)}`;

    assert.deepEqual(call({ "x-api-key": KEY }).next.refusal(), REFUSAL);
    assert.ok(logged.some((line) => /entry 1/.test(line)));
  });

  test("the setting is read again when it changes", () => {
    process.env.INTEGRATION_API_KEY_HASHES = entry("claimsweb", OTHER_KEY);
    assert.deepEqual(call({ "x-api-key": KEY }).next.refusal(), REFUSAL);

    process.env.INTEGRATION_API_KEY_HASHES = entry("claimsweb", KEY);
    assert.equal(call({ "x-api-key": KEY }).next.passed(), true);
  });
});

// The comparison must not stop at the first difference, or at the first held key that matches.
describe("integrationAuth: the comparison", () => {
  test("hashes the key and compares 32-byte digests with timingSafeEqual", () => {
    const compare = mock.method(crypto, "timingSafeEqual");

    call({ "x-api-key": KEY });

    for (const { arguments: args } of compare.mock.calls) {
      assert.equal(args[0].length, 32);
      assert.equal(args[1].length, 32);
    }
    assert.deepEqual(compare.mock.calls[0].arguments[0], crypto.createHash("sha256").update(KEY).digest());
  });

  test("compares against every held key, whether or not the first one matched", () => {
    const compare = mock.method(crypto, "timingSafeEqual");

    call({ "x-api-key": KEY });
    assert.equal(compare.mock.callCount(), 2, "the first of two keys matched");

    call({ "x-api-key": OTHER_KEY });
    assert.equal(compare.mock.callCount(), 4, "the second matched");

    call({ "x-api-key": "claims-web-test-key-9999" });
    assert.equal(compare.mock.callCount(), 6, "none matched");
  });

  test("never compares a key that is not worth hashing", () => {
    const compare = mock.method(crypto, "timingSafeEqual");

    call({});
    call({ "x-api-key": "two words" });

    assert.equal(compare.mock.callCount(), 0);
  });

  test("never compares the key itself, only its hash", () => {
    const compare = mock.method(crypto, "timingSafeEqual");

    call({ "x-api-key": KEY });

    for (const { arguments: args } of compare.mock.calls) assert.notDeepEqual(args[0], Buffer.from(KEY));
  });
});

describe("parseKeyHashes", () => {
  const HEX = sha256(KEY);

  test("reads name:sha256hex:scopes:expires, with spaces round the entries and either case of hex", () => {
    const keys = parseKeyHashes(` claimsweb:${HEX}:${BOTH_SCOPES}:2027-06-30 , backup:${HEX.toUpperCase()}:claims:read:${FAR_FUTURE} `);

    assert.deepEqual(keys.map((key) => key.name), ["claimsweb", "backup"]);
    assert.deepEqual(keys[0].scopes, ["claims:read", "claims:transfer"]);
    assert.deepEqual(keys[1].scopes, ["claims:read"]);
    assert.equal(keys[0].expires, "2027-06-30");
    assert.equal(keys[0].hash.length, 32);
    assert.deepEqual(keys[0].hash, keys[1].hash);
  });

  // The scopes have colons of their own: the name and hash come first, the date last.
  test("scopes written with their own colons are kept whole", () => {
    const [key] = parseKeyHashes(`claims-web:${HEX}:claims:transfer+claims:read:2027-06-30`);

    assert.deepEqual(key.scopes, ["claims:transfer", "claims:read"]);
    assert.equal(key.name, "claims-web");
    assert.equal(key.expires, "2027-06-30");
  });

  test("a scope written twice is kept once", () => {
    assert.deepEqual(parseKeyHashes(`a:${HEX}:claims:read+claims:read:2027-06-30`)[0].scopes, ["claims:read"]);
  });

  test("a key is valid through the end of its day", () => {
    const [key] = parseKeyHashes(`a:${HEX}:claims:read:2027-06-30`);

    assert.equal(key.expiresAt, Date.UTC(2027, 6, 1));
  });

  test("nothing set is no keys", () => {
    for (const value of [undefined, null, "", "  "]) assert.deepEqual(parseKeyHashes(value), []);
  });

  test("an entry that is not name:sha256hex:scopes:expires throws, naming its place and never its text", () => {
    for (const bad of [
      `claimsweb`,
      `claimsweb:${HEX}`,
      `claimsweb:${HEX}:2027-06-30`,
      `claimsweb:${HEX}:claims:read`,
      `:${HEX}:claims:read:2027-06-30`,
      `bad name:${HEX}:claims:read:2027-06-30`,
      `claimsweb:${HEX.slice(1)}:claims:read:2027-06-30`,
      `claimsweb:${HEX}00:claims:read:2027-06-30`,
      `claimsweb:${"z".repeat(64)}:claims:read:2027-06-30`,
      `claimsweb:${HEX}::2027-06-30`,
      `claimsweb:${HEX}:claims:write:2027-06-30`,
      `claimsweb:${HEX}:claims:read+:2027-06-30`,
      `claimsweb:${HEX}:claims:read+admin:2027-06-30`,
      `claimsweb:${HEX}:claims:read:2027-02-30`,
      `claimsweb:${HEX}:claims:read:2027-6-30`,
      `claimsweb:${HEX}:claims:read:30/06/2027`,
      `claimsweb:${HEX}:claims:read:`,
      `${entry("claimsweb", KEY)},`,
    ])
      assert.throws(
        () => parseKeyHashes(bad),
        (error) => /entry \d+ is not name:sha256hex:scopes:expires \(.+\)/.test(error.message) && !error.message.includes(HEX.slice(0, 20)),
        bad,
      );
  });

  test("says which part is wrong", () => {
    assert.throws(() => parseKeyHashes(`a b:${HEX}:claims:read:2027-06-30`), /\(name\)/);
    assert.throws(() => parseKeyHashes(`a:${HEX.slice(1)}:claims:read:2027-06-30`), /\(sha256 hash\)/);
    assert.throws(() => parseKeyHashes(`a:${HEX}:claims:write:2027-06-30`), /\(scopes\)/);
    assert.throws(() => parseKeyHashes(`a:${HEX}:claims:read:2027-13-01`), /\(expires date\)/);
    assert.throws(() => parseKeyHashes(`a:${HEX}`), /\(too few parts\)/);
  });
});

describe("expiryOf", () => {
  test("is the first instant after the date, in UTC", () => {
    assert.equal(expiryOf("2027-06-30"), Date.UTC(2027, 5, 30) + 24 * 60 * 60 * 1000);
    assert.equal(expiryOf("2028-02-29"), Date.UTC(2028, 2, 1), "a leap day exists");
  });

  test("is null for what is not a real date", () => {
    for (const text of ["2027-02-29", "2027-13-01", "2027-00-10", "27-06-30", "2027-06-30T00:00:00Z", "", undefined, null])
      assert.equal(expiryOf(text), null, String(text));
  });
});

describe("describeKeys", () => {
  const NOW = Date.UTC(2027, 5, 1, 12, 0, 0);

  const keys = (...expires) =>
    parseKeyHashes(setting(...expires.map((date, index) => entry(`key${index}`, `${KEY}${index}`, { expires: date }))));

  test("lists each key's name, scopes and expiry, and nothing of the hash", () => {
    const { lines } = describeKeys(
      parseKeyHashes(setting(entry("claimsweb", KEY), entry("backup", OTHER_KEY, { scopes: "claims:read", expires: "2027-12-31" }))),
      NOW,
    );

    assert.deepEqual(lines, [
      `claimsweb scopes ${BOTH_SCOPES} expires ${FAR_FUTURE}`,
      "backup scopes claims:read expires 2027-12-31",
    ]);
    assert.ok(lines.every((line) => !line.includes(sha256(KEY))));
  });

  test("warns for a key that expires within 14 days, and not for one that expires later", () => {
    const { warnings } = describeKeys(keys("2027-06-14", "2027-06-15", "2027-06-16", "2028-01-01"), NOW);

    // 14 June ends at the start of the 15th: 13.5 days from NOW. 15 June is 14.5 days away.
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /key0 expires in 14 day\(s\), on 2027-06-14/);
  });

  test("warns for a key that has expired, and for one that expires today", () => {
    const { warnings } = describeKeys(keys("2027-05-31", "2027-06-01"), NOW);

    assert.match(warnings[0], /key0 expired on 2027-05-31/);
    assert.match(warnings[1], /key1 expires in 1 day\(s\), on 2027-06-01/);
  });

  test("says nothing when every key is far from its end", () => {
    assert.deepEqual(describeKeys(keys("2028-01-01", "2029-01-01"), NOW).warnings, []);
  });
});
