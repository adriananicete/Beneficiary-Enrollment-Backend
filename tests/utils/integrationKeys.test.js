import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  hashKey,
  matchingKey,
  newKey,
  parseAllowedAddresses,
  parseKeyHashes,
  plainAddress,
} from "../../src/utils/integrationKeys.js";

// The key IPS holds and the hash this server keeps (md/IPS-INTEGRATION-DECISIONS.md).

// SHA-256 of "abc", from the standard's own test vectors, so hashKey is pinned to a value worked
// out elsewhere and not to itself.
const ABC_SHA256 = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

describe("hashKey and newKey", () => {
  test("hashKey is SHA-256 in lower-case hexadecimal", () => {
    assert.equal(hashKey("abc"), ABC_SHA256);
  });

  test("a new key is 32 random bytes, URL-safe, and never the same twice", () => {
    const a = newKey();
    const b = newKey();

    assert.match(a, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(Buffer.from(a, "base64url").length, 32);
    assert.notEqual(a, b);
  });
});

describe("parseKeyHashes", () => {
  test("unset or blank is no key at all: the API is off", () => {
    for (const raw of [undefined, null, "", "  ", ",", " , "]) assert.deepEqual(parseKeyHashes(raw, "X"), [], String(raw));
  });

  test("one or several hashes, trimmed and in lower case", () => {
    const upper = ABC_SHA256.toUpperCase();
    const other = hashKey("other");

    assert.deepEqual(parseKeyHashes(` ${upper} , ${other} `, "X"), [ABC_SHA256, other]);
  });

  test("anything that is not a hash stops the server, without repeating the value", () => {
    for (const bad of ["abc", ABC_SHA256.slice(1), `${ABC_SHA256}0`, ABC_SHA256.replace("a", "g"), newKey()])
      assert.throws(
        () => parseKeyHashes(`${ABC_SHA256},${bad}`, "IPS_API_KEY_HASHES"),
        (error) => {
          assert.match(error.message, /^IPS_API_KEY_HASHES: item 2 is not a SHA-256 hash/);
          assert.ok(!error.message.includes(bad), "the message must not carry the value, which may be a key pasted by mistake");
          return true;
        },
        bad,
      );
  });
});

describe("parseAllowedAddresses", () => {
  test("unset or blank allows any address", () => {
    for (const raw of [undefined, "", " "]) assert.deepEqual(parseAllowedAddresses(raw, "X"), []);
  });

  test("IPv4 and IPv6 addresses, trimmed", () => {
    assert.deepEqual(parseAllowedAddresses(" 10.0.0.5 , ::1,2001:db8::7 ", "X"), ["10.0.0.5", "::1", "2001:db8::7"]);
  });

  test("a name, a range or a typo stops the server", () => {
    for (const bad of ["ips.phillife.com.ph", "10.0.0.0/24", "10.0.0", "10.0.0.256"])
      assert.throws(() => parseAllowedAddresses(`10.0.0.5,${bad}`, "IPS_ALLOWED_IPS"), /^Error: IPS_ALLOWED_IPS: item 2/, bad);
  });
});

describe("plainAddress", () => {
  test("an IPv4 caller on a dual-stack socket is read as plain IPv4", () => {
    assert.equal(plainAddress("::ffff:10.0.0.5"), "10.0.0.5");
  });

  test("anything else is left as it is", () => {
    for (const ip of ["10.0.0.5", "::1", "2001:db8::7", "::ffff:zzz", undefined]) assert.equal(plainAddress(ip), ip);
  });
});

describe("matchingKey", () => {
  const key = newKey();
  const hashes = [hashKey("the old key"), hashKey(key)];

  test("the right key is found, and answered by the first eight characters of its hash", () => {
    assert.equal(matchingKey(key, hashes), hashKey(key).slice(0, 8));
  });

  test("while a key is replaced, the old one works too, under its own id", () => {
    assert.equal(matchingKey("the old key", hashes), hashKey("the old key").slice(0, 8));
  });

  test("a wrong, missing, empty, overlong or non-text key is null", () => {
    for (const given of [`${key}x`, key.toLowerCase() === key ? `${key}A` : key.toLowerCase(), undefined, null, "", "x".repeat(201), ["a"], 42])
      assert.equal(matchingKey(given, hashes), null, String(given));
  });

  // The cap is checked before hashing, so even a long text whose hash is on the list is refused.
  // Without this case the cap could go and nothing would notice: a random long text matches nothing.
  test("a key over 200 characters is refused even when its hash is set", () => {
    const long = "x".repeat(201);

    assert.equal(matchingKey(long, [hashKey(long)]), null);
    assert.equal(matchingKey(long.slice(1), [hashKey(long.slice(1))]), hashKey(long.slice(1)).slice(0, 8), "200 is still allowed");
  });

  test("with no hashes set, nothing matches", () => {
    assert.equal(matchingKey(key, []), null);
  });

  test("the hash itself is not a key", () => {
    assert.equal(matchingKey(hashKey(key), hashes), null);
  });
});
