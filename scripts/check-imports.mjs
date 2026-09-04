// Catches an identifier a file uses but never imports or declares.
//
// This exists because of one real incident. parseSearch was moved out of a
// controller and into src/utils/parsePaging.js so a second controller would not
// have to copy it. One importer was updated and the other was not, and
// GET /api/v1/admin/enrollments answered "Server Error" on main until the
// frontend hit it.
//
// Nothing available at the time could have caught it. `node --check` only
// parses, and the syntax was valid — the failure is a ReferenceError at run
// time. Importing the module would have found it instantly, but importing
// anything that reaches src/config/db.js opens a database connection, and that
// is not allowed here. So this reads the source instead.
//
// Scope, deliberately narrow: names exported from src/utils and src/middlewares.
// That is where the shared helpers live, and a moved export is what leaves a
// stale import behind. It is not a linter — it will not find a typo, a wrong
// import path, or a helper passed as a value rather than called. If ESLint with
// no-undef is ever added, it covers all of this and more, and this file should
// go.
//
// Run: npm run check
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory()
      ? walk(full)
      : full.endsWith(".js")
        ? [full]
        : [];
  });

const files = walk(SRC);

// 1. Every name exported from utils and middlewares, and the file it came from.
const exported = new Map();
for (const file of files) {
  if (!/[\\/](utils|middlewares)[\\/]/.test(file)) continue;

  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(
    /^export\s+(?:const|function|let)\s+([A-Za-z_$][\w$]*)/gm,
  )) {
    exported.set(match[1], file);
  }
}

// 2. For each file, the names it imports plus the names it declares itself.
const namesKnownTo = (source) => {
  const names = new Set();

  for (const match of source.matchAll(/^import\s+([^;]+?)\s+from\s+['"]/gms)) {
    for (const name of match[1].matchAll(/[A-Za-z_$][\w$]*/g)) names.add(name[0]);
  }
  for (const match of source.matchAll(
    /^(?:export\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm,
  )) {
    names.add(match[1]);
  }

  return names;
};

// 3. Report anything called but neither imported nor declared. Comments and
//    string literals are stripped first, so a name mentioned in prose — and
//    this file is full of that — is not counted as a use.
let problems = 0;
for (const file of files) {
  const source = readFileSync(file, "utf8");
  const known = namesKnownTo(source);

  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/(['"`])(?:\\.|(?!\1)[\s\S])*?\1/g, "''");

  for (const [name, definedIn] of exported) {
    if (definedIn === file) continue;
    if (known.has(name)) continue;
    if (!new RegExp(`\\b${name}\\s*\\(`).test(code)) continue;

    console.log(
      `MISSING IMPORT  ${relative(ROOT, file)}  calls ${name}  (exported by ${relative(ROOT, definedIn)})`,
    );
    problems += 1;
  }
}

console.log(
  problems === 0
    ? `clean - ${files.length} files, ${exported.size} shared exports checked`
    : `${problems} problem(s) - each one would be a ReferenceError at run time`,
);

process.exit(problems === 0 ? 0 : 1);
