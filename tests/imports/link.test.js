import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

// Sets the required variables in-process before anything reaches env.js, which
// throws on import when one is missing. Must run before the dynamic imports
// below, which is why they are dynamic — a static import would be hoisted above
// this line.
import "../helpers/env.js";

const SRC = new URL("../../src/", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");

const jsFiles = readdirSync(SRC, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
  .map((entry) => join(entry.parentPath, entry.name))
  .sort();

// What this catches, and what it does not — both were verified rather than
// assumed, because the note this replaces was wrong.
//
// It catches a named import the target module does not export. A moved,
// renamed or deleted export fails at link time with "does not provide an
// export named X", before a line runs. It also catches a bad specifier, a
// syntax error, and anything that throws while a module is being evaluated.
//
// It does NOT catch the PR #77 bug, and CLAUDE.md §11 and the message on
// 12fd5c6 both say it would. They are wrong. parseSearch was never imported at
// all — an identifier that is never bound is valid syntax and a valid module,
// and it fails with ReferenceError at call time. Importing the file passes
// cleanly. `npm run check` is what covers that, which is why both run in
// `npm run verify` and neither replaces the other.
//
// It is also the proof that nothing connects, and that half was measured too.
// DB_SERVER is "test-server", which does not resolve. With the eager pool put
// back, this file reports no assertions at all: the connect fails after about
// three seconds, process.exit(1) fires inside the child process running the
// file, and all of its cases are lost as one file-level failure. On a machine
// that can reach the real database it is quieter and worse — the file passes
// while holding an open pool.
describe("every file in src/ links", () => {
  test("there are files to check", () => {
    // Guards against the walk silently finding nothing and every case below
    // passing by vacancy.
    assert.ok(jsFiles.length > 40, `only found ${jsFiles.length} files under src/`);
  });

  for (const file of jsFiles) {
    test(relative(SRC, file).replace(/\\/g, "/"), async () => {
      await assert.doesNotReject(() => import(pathToFileURL(file).href));
    });
  }
});

describe("the pool is not built at import", () => {
  test("db.js exports a function rather than a live connection", async () => {
    const { getPool } = await import("../../src/config/db.js");

    assert.equal(typeof getPool, "function");
  });
});
