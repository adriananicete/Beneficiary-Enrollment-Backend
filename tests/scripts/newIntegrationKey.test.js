import { afterEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import "../helpers/env.js";
import { makeNext, makeReq } from "../helpers/http.js";
import { sha256 } from "../helpers/integrationKeys.js";

const { DEFAULT_SCOPES, checkArguments, entryFor, main, newKey } = await import("../../scripts/new-integration-key.mjs");
const { integrationAuth, parseKeyHashes } = await import("../../src/middlewares/integrationAuth.js");

// scripts/new-integration-key.mjs (docs/claims-details/CONTRACT.md, "A tool for keys"): the pure parts,
// and that nothing is stored.

const NOW = Date.UTC(2026, 10, 4, 15, 0, 0); // 4 Nov 2026, 15:00 UTC

const refuses = (argv, message) =>
  assert.throws(() => checkArguments(argv, NOW), message, argv.join(" "));

afterEach(() => mock.restoreAll());

describe("checkArguments", () => {
  test("a name and a date are enough: both scopes by default", () => {
    assert.deepEqual(checkArguments(["--name", "claims-web", "--expires", "2027-06-30"], NOW), {
      name: "claims-web",
      scopes: ["claims:read", "claims:transfer"],
      expires: "2027-06-30",
    });
    assert.equal(DEFAULT_SCOPES, "claims:read+claims:transfer");
  });

  test("scopes can be narrowed, in either order, and a repeat is kept once", () => {
    const scopesOf = (text) => checkArguments(["--name", "a", "--expires", "2027-06-30", "--scopes", text], NOW).scopes;

    assert.deepEqual(scopesOf("claims:read"), ["claims:read"]);
    assert.deepEqual(scopesOf("claims:transfer"), ["claims:transfer"]);
    assert.deepEqual(scopesOf("claims:transfer+claims:read"), ["claims:transfer", "claims:read"]);
    assert.deepEqual(scopesOf("claims:read+claims:read"), ["claims:read"]);
  });

  test("--name is required, and is a name the server will read back", () => {
    refuses(["--expires", "2027-06-30"], /--name is required/);
    refuses(["--name", "", "--expires", "2027-06-30"], /--name is required/);
    refuses(["--name", "claims web", "--expires", "2027-06-30"], /--name is required/);
    refuses(["--name", "claims:web", "--expires", "2027-06-30"], /--name is required/);
    refuses(["--name", "n".repeat(51), "--expires", "2027-06-30"], /--name is required/);

    assert.equal(checkArguments(["--name", "n".repeat(50), "--expires", "2027-06-30"], NOW).name.length, 50);
  });

  test("--expires is required, and a real date", () => {
    refuses(["--name", "a"], /--expires is required/);
    refuses(["--name", "a", "--expires", ""], /--expires is required/);

    for (const text of ["2027-02-30", "2027-13-01", "30/06/2027", "2027-6-30", "tomorrow", "2027-06-30T00:00:00Z"])
      refuses(["--name", "a", "--expires", text], /--expires is required, as a real date/);
  });

  test("--expires must be after today, in UTC", () => {
    const expires = (text) => ["--name", "a", "--expires", text];

    refuses(expires("2020-01-01"), /after today/);
    refuses(expires("2026-11-03"), /after today/);
    refuses(expires("2026-11-04"), /after today/);

    assert.equal(checkArguments(expires("2026-11-05"), NOW).expires, "2026-11-05");
  });

  test("the day is the UTC day: late on the 4th in UTC is still the 4th", () => {
    const lateOnThe4th = Date.UTC(2026, 10, 4, 23, 59, 59);

    assert.throws(() => checkArguments(["--name", "a", "--expires", "2026-11-04"], lateOnThe4th), /after today/);
    assert.doesNotThrow(() => checkArguments(["--name", "a", "--expires", "2026-11-05"], lateOnThe4th));
  });

  test("--scopes can only be the two the server knows", () => {
    for (const text of ["claims:write", "claims:read+admin", "claims:read+", "", "read", "CLAIMS:READ"])
      refuses(["--name", "a", "--expires", "2027-06-30", "--scopes", text], /--scopes must be claims:read and\/or claims:transfer/);
  });

  test("an option it does not know, and a stray word, are refused", () => {
    refuses(["--name", "a", "--expires", "2027-06-30", "--key", "mine"], /key/);
    refuses(["--name", "a", "--expires", "2027-06-30", "extra"], /extra/);
    refuses(["--name"], /name/);
  });
});

describe("newKey", () => {
  test("is 32 random bytes as hex, and a different one each time", () => {
    const first = newKey();
    const second = newKey();

    assert.match(first, /^[0-9a-f]{64}$/);
    assert.notEqual(first, second);
  });

  test("asks for exactly 32 bytes", () => {
    let asked;
    const key = newKey((size) => {
      asked = size;
      return Buffer.alloc(size, 0xab);
    });

    assert.equal(asked, 32);
    assert.equal(key, "ab".repeat(32));
  });
});

describe("entryFor", () => {
  const options = { name: "claims-web", scopes: ["claims:read", "claims:transfer"], expires: "2027-06-30" };
  const KEY = "a1".repeat(32);

  test("is name:sha256hex:scopes:expires, with the hash of the key and not the key", () => {
    const line = entryFor(options, KEY);

    assert.equal(line, `claims-web:${sha256(KEY)}:claims:read+claims:transfer:2027-06-30`);
    assert.equal(line.includes(KEY), false);
  });

  test("is a line the server reads back as the same name, scopes and date", () => {
    const [parsed] = parseKeyHashes(entryFor(options, KEY));

    assert.equal(parsed.name, "claims-web");
    assert.deepEqual(parsed.scopes, ["claims:read", "claims:transfer"]);
    assert.equal(parsed.expires, "2027-06-30");
    assert.equal(parsed.hash.toString("hex"), sha256(KEY));
  });

  test("and the key opens the server with it", () => {
    const saved = process.env.INTEGRATION_API_KEY_HASHES;
    process.env.INTEGRATION_API_KEY_HASHES = entryFor({ ...options, expires: "2099-12-31" }, KEY);

    try {
      const req = makeReq({ headers: { "x-api-key": KEY } });
      const next = makeNext();
      integrationAuth(req, {}, next);

      assert.equal(next.passed(), true);
      assert.deepEqual(req.integration, { name: "claims-web", scopes: ["claims:read", "claims:transfer"] });
    } finally {
      if (saved === undefined) delete process.env.INTEGRATION_API_KEY_HASHES;
      else process.env.INTEGRATION_API_KEY_HASHES = saved;
    }
  });
});

describe("main", () => {
  const run = (argv) => {
    const out = [];
    const fail = [];
    const code = main(argv, {
      out: (line) => out.push(line),
      fail: (line) => fail.push(line),
      randomBytes: (size) => Buffer.alloc(size, 0xcd),
    });

    return { code, out: out.join("\n"), fail: fail.join("\n") };
  };

  const KEY = "cd".repeat(32);

  test("prints the key once and the line to add, and exits 0", () => {
    const { code, out, fail } = run(["--name", "claims-web", "--expires", "2099-12-31"]);

    assert.equal(code, 0);
    assert.equal(fail, "");
    assert.equal(out.split(KEY).length - 1, 1, "the key appears once");
    assert.ok(out.includes(`claims-web:${sha256(KEY)}:claims:read+claims:transfer:2099-12-31`));
    assert.match(out, /INTEGRATION_API_KEY_HASHES/);
    assert.match(out, /secure channel/);
  });

  test("a bad argument prints what to fix and the usage, never a key, and exits 1", () => {
    const { code, out, fail } = run(["--name", "claims-web"]);

    assert.equal(code, 1);
    assert.equal(out, "");
    assert.match(fail, /--expires is required/);
    assert.match(fail, /Usage: npm run integration-key/);
    assert.equal(fail.includes(KEY), false);
  });

  test("stores nothing: no file is written", () => {
    const writes = ["writeFileSync", "appendFileSync", "createWriteStream", "writeSync", "openSync"].map((name) => mock.method(fs, name));

    run(["--name", "claims-web", "--expires", "2099-12-31"]);
    run(["--name", "claims-web"]);

    for (const write of writes) assert.equal(write.mock.callCount(), 0);
  });

  test("the script does not even load the file system", () => {
    const source = fs.readFileSync(new URL("../../scripts/new-integration-key.mjs", import.meta.url), "utf8");

    assert.doesNotMatch(source, /from "(node:)?fs(\/promises)?"/);
    assert.doesNotMatch(source, /require\(/);
  });
});

describe("the npm script", () => {
  test("follows the pattern of the others: node scripts/<file>", () => {
    const { scripts } = JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8"));

    assert.equal(scripts["integration-key"], "node scripts/new-integration-key.mjs");
    assert.equal(scripts.check, "node scripts/check-imports.mjs");
  });
});
