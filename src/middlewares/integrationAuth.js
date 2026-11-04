import crypto from "node:crypto";
import { AppError } from "../utils/AppError.js";

// The claims web app's way in (docs/claims-details/CONTRACT.md, "The hand-off API" and "Security of
// the hand-off API"). It is a program, not a person: no cookie, no session, a key in the X-API-Key
// header.
//
// The server holds only SHA-256 hashes of the keys, in INTEGRATION_API_KEY_HASHES, one entry per
// key, separated by commas:
//
//   name:sha256hex:scopes:expires
//   claims-web:9f2c...:claims:read+claims:transfer:2027-06-30
//
// The scopes are joined with +, and contain colons themselves, so the name and the hash are the
// first two parts and the date the last. The key that is presented is hashed and compared with the
// held ones in constant time. A key is revoked by taking its entry out and restarting; two entries
// may share a name, so a new key can be added before the old one goes. The name says who called, in
// the log and in the rate limit.
//
// A missing, malformed, unknown and expired key are refused with one message, so a caller learns
// nothing about which it was. The key is never logged or echoed.

const REFUSED = "Unauthorized: a valid API key is required.";

export const INTEGRATION_SCOPES = ["claims:read", "claims:transfer"];

const HEX_SHA256 = /^[0-9a-f]{64}$/i;
export const KEY_NAME = /^[A-Za-z0-9._-]{1,50}$/;

// A key is printable ASCII with no spaces, and no longer than any real one: the shape check
// spares the hash a header of arbitrary bytes.
const KEY_SHAPE = /^[\x21-\x7e]{1,256}$/;

const DAY_MS = 24 * 60 * 60 * 1000;

// The first instant after the last day a key is valid: a key is good through the end of its
// "expires" date, in UTC. Null when the text is not a real date.
export const expiryOf = (text) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text ?? "");
  if (!match) return null;

  const [year, month, day] = match.slice(1).map(Number);
  const start = new Date(Date.UTC(year, month - 1, day));

  const real = start.getUTCFullYear() === year && start.getUTCMonth() === month - 1 && start.getUTCDate() === day;

  return real ? start.getTime() + DAY_MS : null;
};

// Which part of an entry is wrong, or null. Never the part's text: one of them is a hash.
const problemWith = ({ name, hash, scopes, expires }) => {
  if (!KEY_NAME.test(name ?? "")) return "name";
  if (!HEX_SHA256.test(hash ?? "")) return "sha256 hash";
  if (scopes.length === 0 || scopes.some((scope) => !INTEGRATION_SCOPES.includes(scope))) return "scopes";
  if (expiryOf(expires) === null) return "expires date";

  return null;
};

// [{ name, hash, scopes, expires, expiresAt }] from the setting. An empty value is no keys. A
// malformed entry throws, naming its place and which part, so a mistyped entry cannot quietly leave
// a key out. The old name:hash form, with no scopes and no expiry, is malformed.
export const parseKeyHashes = (value) => {
  if (typeof value !== "string" || value.trim() === "") return [];

  return value.split(",").map((entry, index) => {
    const parts = entry.trim().split(":");
    const fields = {
      name: parts[0],
      hash: parts[1],
      scopes: parts.slice(2, -1).join(":").split("+"),
      expires: parts.at(-1),
    };

    const problem = parts.length < 4 ? "too few parts" : problemWith(fields);
    if (problem)
      throw new Error(`INTEGRATION_API_KEY_HASHES entry ${index + 1} is not name:sha256hex:scopes:expires (${problem})`);

    return {
      name: fields.name,
      hash: Buffer.from(fields.hash, "hex"),
      scopes: [...new Set(fields.scopes)],
      expires: fields.expires,
      expiresAt: expiryOf(fields.expires),
    };
  });
};

export const EXPIRY_WARNING_DAYS = 14;

// What the server says once at start: each key's name, scopes and expiry, and a warning for any that
// has expired or will within two weeks.
export const describeKeys = (keys, now = Date.now()) => ({
  lines: keys.map((key) => `${key.name} scopes ${key.scopes.join("+")} expires ${key.expires}`),
  warnings: keys.flatMap((key) => {
    const left = key.expiresAt - now;

    if (left <= 0) return [`Integration key ${key.name} expired on ${key.expires} and is refused.`];
    if (left <= EXPIRY_WARNING_DAYS * DAY_MS)
      return [`Integration key ${key.name} expires in ${Math.ceil(left / DAY_MS)} day(s), on ${key.expires}.`];

    return [];
  }),
});

// Parsed again only when the variable changes, and a malformed one holds no keys: refusing every
// call is the safe way to fail. The server checks it once at start (server.js) and refuses to boot.
let held = { source: null, keys: [] };

const keysNow = () => {
  const source = process.env.INTEGRATION_API_KEY_HASHES ?? "";

  if (held.source !== source) {
    try {
      held = { source, keys: parseKeyHashes(source) };
    } catch (error) {
      console.error(error.message);
      held = { source, keys: [] };
    }
  }

  return held.keys;
};

// Both are 32-byte digests, so timingSafeEqual never sees unequal lengths, and every held hash is
// compared whether or not an earlier one matched. A key past its date is a key not found.
const entryOfKey = (key) => {
  const presented = crypto.createHash("sha256").update(key).digest();
  const now = Date.now();
  let found = null;

  for (const entry of keysNow())
    if (crypto.timingSafeEqual(presented, entry.hash) && found === null && now < entry.expiresAt) found = entry;

  return found;
};

export const integrationAuth = (req, res, next) => {
  const key = req.headers?.["x-api-key"];

  const entry = typeof key === "string" && KEY_SHAPE.test(key) ? entryOfKey(key) : null;
  if (entry === null) return next(new AppError(REFUSED, 401));

  req.integration = { name: entry.name, scopes: entry.scopes };

  next();
};

// The key is known by now, so the answer may say what it lacks.
export const requireScope = (scope) => (req, res, next) =>
  req.integration?.scopes.includes(scope)
    ? next()
    : next(new AppError(`This API key does not have the scope ${scope}.`, 403));

export default { integrationAuth, requireScope, parseKeyHashes, describeKeys };
