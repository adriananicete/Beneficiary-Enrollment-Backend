import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Group Credit Life (GCLI) before the database has it.
//
// A company's plan, its loan limits, the borrowers' applications and HR's
// decisions need tables and procedures that the DBA has not written
// (docs/backend-handoff.md 2.12). Until then they live in a JSON file next to
// the server, so the frontend can be tried against real routes without a change
// to the database. It is read and written only by src/gcli, and only while
// GCLI_DEV_STORE=true.
//
// What this is not: a place for real data. Nothing in it reaches the database,
// no login is made for a borrower and no email is sent. The server refuses to
// start with it on in production (assertDevStoreAllowed), and every hook in the
// rest of the code asks devStoreOn() first, so with the flag off the routes
// behave exactly as they did.

const STORE_FILE = fileURLToPath(new URL("../../.gcli-dev-store.json", import.meta.url));

// Read at call time, not at import, so a test can switch it and put it back.
export const devStoreOn = () =>
  process.env.GCLI_DEV_STORE === "true" && process.env.NODE_ENV !== "production";

export const assertDevStoreAllowed = () => {
  if (process.env.GCLI_DEV_STORE === "true" && process.env.NODE_ENV === "production")
    throw new Error(
      "GCLI_DEV_STORE=true is for development only: it keeps loan applications in a file, not in the database. Remove it from the production environment.",
    );
};

const fileOf = () => process.env.GCLI_DEV_STORE_FILE || STORE_FILE;

const emptyStore = () => ({
  // The last application number given, so a number is never reused.
  lastApplication: 0,
  // employer_id -> { plan_code, plan_desc, plan_template, loan_limits }
  companies: {},
  applications: [],
});

let loaded = null;
let loadedFrom = null;
let loadedStamp = null;

// When the file last changed, or null if there is none. A file edited or deleted by hand
// while the server runs is read again, not overwritten by what was held in memory.
const stampOf = (file) => {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
};

const load = () => {
  const file = fileOf();
  const stamp = stampOf(file);
  if (loaded && loadedFrom === file && loadedStamp === stamp) return loaded;

  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  let found = emptyStore();
  if (text !== undefined) {
    try {
      found = { ...found, ...JSON.parse(text) };
    } catch {
      throw new Error(`The GCLI dev store ${file} is not valid JSON. Fix it or delete it to start again.`);
    }
  }

  loaded = found;
  loadedFrom = file;
  loadedStamp = stamp;
  return loaded;
};

// The store as it is now. Read it; change it only through update().
export const readStore = () => load();

// Runs `change` on a copy and keeps the copy only if it did not throw, so a
// refused request leaves the file as it was. Written whole through a temporary
// file, so a crash cannot leave half of one.
export const update = (change) => {
  const draft = structuredClone(load());
  const result = change(draft);

  const file = fileOf();
  const partial = `${file}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(partial, JSON.stringify(draft, null, 2));
  fs.renameSync(partial, file);

  loaded = draft;
  loadedFrom = file;
  loadedStamp = stampOf(file);
  return result;
};

// For tests: forget what was read, so the next call reads the file again.
export const forgetStore = () => {
  loaded = null;
  loadedFrom = null;
  loadedStamp = null;
};

export default { devStoreOn, assertDevStoreAllowed, readStore, update, forgetStore };
