import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

// Every procedure and table in src/ is named with its schema.
//
// The database moved out of dbo into bes and sec (re-created 2026-10-27/28).
// The app login's default schema is dbo, read on UAT 2026-11-11, and nothing is
// left there, so a bare name or a dbo. name is "Could not find stored procedure"
// (2812) at run time.
//
// No other test can see this. The fake pool matches a bare name against a
// qualified call (tests/helpers/fakePool.js), so a model written with a bare
// name and a test scripting the same bare name pass together and fail in the
// database. This reads the source instead.

const SRC = new URL("../../src/", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");

const sources = readdirSync(SRC, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
  .map((entry) => join(entry.parentPath, entry.name))
  .sort()
  .map((file) => ({
    name: relative(SRC, file).replace(/\\/g, "/"),
    text: readFileSync(file, "utf8"),
  }));

const QUALIFIED = /^(bes|sec)\.\w+$/;

const executed = sources.flatMap(({ name, text }) =>
  [...text.matchAll(/\.execute\(\s*(['"`])([^'"`]+)\1\s*\)/g)].map((match) => ({
    name,
    procedure: match[2],
  })),
);

const queries = sources.flatMap(({ name, text }) =>
  [...text.matchAll(/\.query\(\s*`([\s\S]*?)`/g)].map((match) => ({ name, sql: match[1] })),
);

describe("procedures and tables are named with their schema", () => {
  test("there are calls to check", () => {
    // Guards against the walk silently finding nothing.
    assert.ok(executed.length > 80, `only found ${executed.length} procedure calls under src/`);
    assert.ok(queries.length > 0, "found no raw queries under src/");
  });

  test("every execute() names bes. or sec.", () => {
    const unqualified = executed
      .filter(({ procedure }) => !QUALIFIED.test(procedure))
      .map(({ name, procedure }) => `${name}: ${procedure}`);

    assert.deepEqual(unqualified, []);
  });

  test("every execute() names its procedure as a literal", () => {
    // A name held in a variable would slip past the check above.
    const dynamic = sources.flatMap(({ name, text }) =>
      [...text.matchAll(/\.execute\(\s*([^'"`\s)][^)]*)\)/g)].map((match) => `${name}: execute(${match[1]})`),
    );

    assert.deepEqual(dynamic, []);
  });

  test("every table in a raw query names bes. or sec.", () => {
    const unqualified = queries.flatMap(({ name, sql }) =>
      [...sql.matchAll(/\b(FROM|JOIN|UPDATE|INTO)\s+([^\s(@#]+)/gi)]
        .map((match) => match[2].replace(/[[\]]/g, ""))
        .filter((table) => !QUALIFIED.test(table))
        .map((table) => `${name}: ${table}`),
    );

    assert.deepEqual(unqualified, []);
  });
});
