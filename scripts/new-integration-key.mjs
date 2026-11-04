// Makes a key for the claims web app's hand-off API (docs/claims-details/CONTRACT.md, "A tool for
// keys"). Prints the key once, to the terminal, and the line to add to INTEGRATION_API_KEY_HASHES.
// It stores nothing and writes no file: the server keeps only the hash, so a key that is lost is
// replaced with a new one, and two entries with one name may stand together while the new one is
// handed over.
//
// Run: npm run integration-key -- --name claims-web --expires 2027-06-30
//      [--scopes claims:read+claims:transfer]
//
// The key goes to the claims web app's team through a secure channel, and never into the
// repository, a ticket or a chat.
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { INTEGRATION_SCOPES, KEY_NAME, expiryOf, parseKeyHashes } from "../src/middlewares/integrationAuth.js";

export const DEFAULT_SCOPES = "claims:read+claims:transfer";

export const USAGE =
  "Usage: npm run integration-key -- --name <name> --expires <YYYY-MM-DD> [--scopes claims:read+claims:transfer]";

// { name, scopes, expires } from the command line, or an Error that says what to fix. `now` is a
// parameter so a test can fix the day.
export const checkArguments = (argv, now = Date.now()) => {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: { name: { type: "string" }, scopes: { type: "string" }, expires: { type: "string" } },
      allowPositionals: false,
    }));
  } catch (error) {
    throw new Error(error.message);
  }

  const { name, expires } = values;

  if (!name || !KEY_NAME.test(name))
    throw new Error("--name is required: 1 to 50 letters, digits, dots, hyphens or underscores.");

  const scopes = [...new Set((values.scopes ?? DEFAULT_SCOPES).split("+"))];
  if (scopes.some((scope) => !INTEGRATION_SCOPES.includes(scope)))
    throw new Error(`--scopes must be ${INTEGRATION_SCOPES.join(" and/or ")}, joined with +.`);

  if (!expires || expiryOf(expires) === null) throw new Error("--expires is required, as a real date: YYYY-MM-DD.");

  // A date, valid through its last second in UTC; one that is today would end the key tonight.
  if (expires <= new Date(now).toISOString().slice(0, 10))
    throw new Error("--expires must be a date after today (UTC).");

  return { name, scopes, expires };
};

// 32 random bytes, as hex.
export const newKey = (randomBytes = crypto.randomBytes) => randomBytes(32).toString("hex");

// The entry for INTEGRATION_API_KEY_HASHES. It is read back with the server's own parser before it
// is returned, so a line this tool prints is a line the server accepts.
export const entryFor = ({ name, scopes, expires }, key) => {
  const hash = crypto.createHash("sha256").update(key).digest("hex");
  const line = `${name}:${hash}:${scopes.join("+")}:${expires}`;

  parseKeyHashes(line);

  return line;
};

export const main = (argv, { out = console.log, fail = console.error, randomBytes } = {}) => {
  let options;
  try {
    options = checkArguments(argv);
  } catch (error) {
    fail(`${error.message}\n${USAGE}`);
    return 1;
  }

  const key = newKey(randomBytes);

  out(`New key for ${options.name} (${options.scopes.join(" and ")}, valid through ${options.expires} UTC).`);
  out("It is shown once and kept nowhere: the server holds only its hash.");
  out("");
  out(`  Key:  ${key}`);
  out("");
  out("Add this entry to INTEGRATION_API_KEY_HASHES (comma-separated, after any entries already there), then restart the server:");
  out("");
  out(`  ${entryFor(options, key)}`);
  out("");
  out("Give the key to the claims web app's team through a secure channel, not through the repository, a ticket or a chat.");

  return 0;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = main(process.argv.slice(2));
