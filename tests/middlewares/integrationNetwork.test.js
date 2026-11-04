import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";
import { makeNext, makeReq, makeRes } from "../helpers/http.js";

const { assertIntegrationNetwork, onlyFromAllowedSources, parseAllowedIps, requireHttps, sourceOf } = await import(
  "../../src/middlewares/integrationNetwork.js"
);

// Where the hand-off API may be reached from, and over what (docs/claims-details/CONTRACT.md,
// "Network" and "Transport").

const saved = {};

beforeEach(() => {
  for (const name of ["INTEGRATION_ALLOWED_IPS", "NODE_ENV"]) saved[name] = process.env[name];
  delete process.env.INTEGRATION_ALLOWED_IPS;
});

afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

// Whether a request from `ip` gets past the allowlist; a refusal leaves the router.
const gets = (ip) => {
  const next = makeNext();

  onlyFromAllowedSources(makeReq({ ip }), makeRes(), next);

  if (next.passed()) return true;
  assert.deepEqual(next.calls, ["router"], `${ip} leaves the router and does not raise an error`);
  return false;
};

describe("parseAllowedIps", () => {
  test("reads addresses and ranges, IPv4 and IPv6, with spaces round them", () => {
    const { list, count } = parseAllowedIps(" 10.1.2.3 , 192.168.4.0/24,fd00::/8, 2001:db8::7 ");

    assert.equal(count, 4);
    assert.equal(list.check("10.1.2.3", "ipv4"), true);
    assert.equal(list.check("192.168.4.200", "ipv4"), true);
    assert.equal(list.check("192.168.5.1", "ipv4"), false);
    assert.equal(list.check("fd12::1", "ipv6"), true);
    assert.equal(list.check("2001:db8::7", "ipv6"), true);
    assert.equal(list.check("2001:db8::8", "ipv6"), false);
  });

  test("nothing set is an empty list", () => {
    for (const value of [undefined, null, "", "   "]) assert.equal(parseAllowedIps(value).count, 0);
  });

  test("a prefix of 0 and the widest prefix are allowed", () => {
    assert.equal(parseAllowedIps("10.0.0.1/32").count, 1);
    assert.equal(parseAllowedIps("::1/128").count, 1);
    assert.equal(parseAllowedIps("0.0.0.0/0").count, 1);
  });

  test("an entry that is not an address or a range throws, naming its place", () => {
    for (const bad of [
      "banana",
      "10.1.2",
      "10.1.2.256",
      "10.1.2.3/33",
      "10.1.2.3/-1",
      "10.1.2.3/",
      "10.1.2.3/8/8",
      "10.1.2.3/abc",
      "::1/129",
      "fe80::1%eth0",
      "10.1.2.3,",
      ",10.1.2.3",
      "10.1.2.3,,10.1.2.4",
      "10.0.0.0/8 10.1.0.0/16",
      "example.com",
    ])
      assert.throws(() => parseAllowedIps(bad), /INTEGRATION_ALLOWED_IPS entry \d+ is not an IP address or a CIDR range/, bad);

    assert.throws(() => parseAllowedIps("10.1.2.3,banana"), /entry 2 /);
  });
});

describe("sourceOf", () => {
  test("is the address Express resolved", () => {
    assert.equal(sourceOf({ ip: "10.1.2.3" }), "10.1.2.3");
    assert.equal(sourceOf({ ip: "fd00::5" }), "fd00::5");
  });

  test("writes an IPv4 address that arrived in its IPv6 form as IPv4", () => {
    assert.equal(sourceOf({ ip: "::ffff:10.1.2.3" }), "10.1.2.3");
    assert.equal(sourceOf({ ip: "::FFFF:10.1.2.3" }), "10.1.2.3");
  });

  test("an address that is missing is unknown", () => {
    for (const req of [{}, { ip: undefined }, { ip: "" }, { ip: 5 }]) assert.equal(sourceOf(req), "unknown");
  });
});

describe("onlyFromAllowedSources", () => {
  test("lets a listed address through and sends any other out of the router", () => {
    process.env.INTEGRATION_ALLOWED_IPS = "10.1.2.3,192.168.4.0/24";

    assert.equal(gets("10.1.2.3"), true);
    assert.equal(gets("192.168.4.77"), true);
    assert.equal(gets("10.1.2.4"), false);
    assert.equal(gets("192.168.5.77"), false);
    assert.equal(gets("127.0.0.1"), false, "this machine too, once there is a list");
  });

  // Node writes an IPv4 caller on a dual-stack socket as ::ffff:a.b.c.d.
  test("an IPv4 address written as IPv6 matches the IPv4 rule", () => {
    process.env.INTEGRATION_ALLOWED_IPS = "10.1.2.3,172.16.0.0/12";

    assert.equal(gets("::ffff:10.1.2.3"), true);
    assert.equal(gets("::ffff:172.20.1.1"), true);
    assert.equal(gets("::ffff:0a01:0203"), true, "the hex form of the same address");
    assert.equal(gets("::ffff:10.1.2.4"), false);
    assert.equal(gets("::ffff:11.1.2.3"), false);
  });

  test("an IPv6 range is matched", () => {
    process.env.INTEGRATION_ALLOWED_IPS = "fd00:1::/32";

    assert.equal(gets("fd00:1::9"), true);
    assert.equal(gets("fd00:2::9"), false);
  });

  test("an address that is not an address, or not there, is refused", () => {
    process.env.INTEGRATION_ALLOWED_IPS = "0.0.0.0/0";

    for (const ip of [undefined, "", "unknown", "banana", "10.1.2", "fe80::1%eth0"]) assert.equal(gets(ip), false, String(ip));
  });

  // There is no "this machine only" default: behind a proxy on the same host every caller can look
  // like 127.0.0.1, so a developer who wants loopback writes it down.
  describe("with no list", () => {
    test("nobody gets in, this machine included, in any NODE_ENV", () => {
      for (const nodeEnv of ["development", "test", "production", "staging"]) {
        process.env.NODE_ENV = nodeEnv;

        for (const ip of ["127.0.0.1", "127.8.9.10", "::1", "::ffff:127.0.0.1", "10.1.2.3"]) assert.equal(gets(ip), false, `${nodeEnv} ${ip}`);
      }
    });

    test("a list that is only spaces is no list", () => {
      process.env.INTEGRATION_ALLOWED_IPS = "   ";

      assert.equal(gets("127.0.0.1"), false);
    });
  });

  test("a developer lists this machine explicitly", () => {
    process.env.NODE_ENV = "development";
    process.env.INTEGRATION_ALLOWED_IPS = "127.0.0.1,::1";

    for (const ip of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) assert.equal(gets(ip), true, ip);
    assert.equal(gets("127.0.0.2"), false, "only the address written, not the whole of 127.0.0.0/8");
    assert.equal(gets("10.1.2.3"), false);
  });

  // Failing closed: a mistyped list must not become "everybody".
  test("a malformed list allows nobody, not even this machine", () => {
    const error = console.error;
    console.error = () => {};
    try {
      process.env.INTEGRATION_ALLOWED_IPS = "10.1.2.3,banana";

      assert.equal(gets("10.1.2.3"), false);
      assert.equal(gets("127.0.0.1"), false);
    } finally {
      console.error = error;
    }
  });

  test("the list is read again when it changes", () => {
    process.env.INTEGRATION_ALLOWED_IPS = "10.1.2.3";
    assert.equal(gets("10.1.2.4"), false);

    process.env.INTEGRATION_ALLOWED_IPS = "10.1.2.4";
    assert.equal(gets("10.1.2.4"), true);
    assert.equal(gets("10.1.2.3"), false);
  });
});

describe("requireHttps", () => {
  const run = (req) => {
    const next = makeNext();

    requireHttps(req, makeRes(), next);

    return next;
  };

  test("plain HTTP from a source that is not this machine is 403 with its own sentence", () => {
    assert.deepEqual(run(makeReq({ ip: "10.1.2.3", secure: false })).refusal(), { statusCode: 403, message: "HTTPS is required." });
    assert.deepEqual(run(makeReq({ ip: "fd00::5", secure: false })).refusal(), { statusCode: 403, message: "HTTPS is required." });
  });

  test("HTTPS passes, from any source", () => {
    assert.equal(run(makeReq({ ip: "10.1.2.3", secure: true })).passed(), true);
    assert.equal(run(makeReq({ ip: "127.0.0.1", secure: true })).passed(), true);
  });

  test("a request that says nothing about being secure is not secure", () => {
    assert.equal(run(makeReq({ ip: "10.1.2.3" })).refusal().statusCode, 403);
  });

  test("this machine may use plain HTTP, so a developer can use curl", () => {
    for (const ip of ["127.0.0.1", "127.5.5.5", "::1", "::ffff:127.0.0.1"])
      assert.equal(run(makeReq({ ip, secure: false })).passed(), true, ip);
  });

  test("a source that is nothing, or not an address, is not this machine", () => {
    for (const ip of [undefined, "", "banana", "128.0.0.1", "::2"]) assert.equal(run(makeReq({ ip, secure: false })).refusal().statusCode, 403, String(ip));
  });

  test("it applies in every NODE_ENV, not only production", () => {
    for (const nodeEnv of ["development", "test", "production", "staging", undefined]) {
      if (nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = nodeEnv;

      assert.equal(run(makeReq({ ip: "10.1.2.3", secure: false })).refusal().statusCode, 403, String(nodeEnv));
    }
  });
});

describe("assertIntegrationNetwork: what the server checks at start", () => {
  const start = (overrides) => assertIntegrationNetwork({ nodeEnv: "development", allowedIps: "", trustProxy: false, keyCount: 0, ...overrides });

  test("returns how many entries the list has", () => {
    assert.equal(start({ allowedIps: "" }), 0);
    assert.equal(start({ allowedIps: "10.1.2.3,10.1.4.0/24" }), 2);
  });

  test("a malformed entry refuses the start, in every NODE_ENV", () => {
    for (const nodeEnv of ["development", "test", "production"])
      assert.throws(() => start({ nodeEnv, allowedIps: "10.1.2.3,banana" }), /entry 2 is not an IP address/, nodeEnv);
  });

  test("a key with no allowed address refuses the start, in every NODE_ENV", () => {
    for (const nodeEnv of ["development", "test", "production", "staging"])
      for (const allowedIps of ["", "   ", undefined])
        assert.throws(() => start({ nodeEnv, allowedIps, keyCount: 1 }), /INTEGRATION_ALLOWED_IPS must list/, `${nodeEnv} ${allowedIps}`);
  });

  test("a key with a list starts, and so does a developer who lists this machine", () => {
    assert.equal(start({ allowedIps: "10.1.2.3", keyCount: 2 }), 1);
    assert.equal(start({ allowedIps: "127.0.0.1,::1", keyCount: 1 }), 2);
  });

  test("with no key an empty list may start in development: nothing can authenticate anyway", () => {
    for (const nodeEnv of ["development", "test"]) assert.doesNotThrow(() => start({ nodeEnv, allowedIps: "", keyCount: 0 }));
  });

  test("production wants a list even before there is a key", () => {
    assert.throws(() => start({ nodeEnv: "production", allowedIps: "", keyCount: 0, trustProxy: 1 }), /INTEGRATION_ALLOWED_IPS must list/);
    assert.equal(start({ nodeEnv: "production", allowedIps: "10.1.2.3", keyCount: 0, trustProxy: 1 }), 1);
  });

  test("\"trust proxy\" true refuses the start in every NODE_ENV; a hop count, false or a list of proxies does not", () => {
    for (const nodeEnv of ["development", "test", "production"])
      assert.throws(() => start({ nodeEnv, allowedIps: "10.1.2.3", keyCount: 1, trustProxy: true }), /trust proxy/, nodeEnv);

    for (const trustProxy of [1, 2, false, "loopback", "10.0.0.1, 10.0.0.2", ["10.0.0.1"]])
      assert.doesNotThrow(() => start({ allowedIps: "10.1.2.3", keyCount: 1, trustProxy }), String(trustProxy));
  });
});
