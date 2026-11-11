import crypto from "node:crypto";
import net from "node:net";

// Keys for another system calling this API server to server (IPS since 2026-11-11). The system
// holds the key; this server keeps only its SHA-256, so a copy of the environment file is not a
// key. A key is 32 random bytes and cannot be guessed, so a fast hash is enough here; a password
// hash is slow because passwords are short.
//
// Several hashes may be set at once, so a key can be replaced without a moment where neither
// works: add the new hash, give IPS the new key, then remove the old hash.

const SHA256_HEX = /^[0-9a-f]{64}$/;

// Longer than any key we hand out, by far. A longer header is refused before it is hashed.
const MAX_KEY_LENGTH = 200;

export const newKey = () => crypto.randomBytes(32).toString("base64url");

export const hashKey = (key) => crypto.createHash("sha256").update(String(key), "utf8").digest("hex");

const listOf = (raw) =>
  String(raw ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");

// The hashes from the environment, in lower case. Empty or unset is an empty list: the API is
// off. A malformed one stops the server, and the error names its place in the list but never
// its value, since the message lands in a log.
export const parseKeyHashes = (raw, name) =>
  listOf(raw).map((item, index) => {
    const hash = item.toLowerCase();

    if (!SHA256_HEX.test(hash))
      throw new Error(
        `${name}: item ${index + 1} is not a SHA-256 hash (64 hexadecimal characters). ` +
          "Put the hash there, never the key itself. `npm run ips-key` makes a key and its hash.",
      );

    return hash;
  });

// The addresses allowed to call, exact IPv4 or IPv6 addresses. Empty or unset allows any
// address, and the key is then the only check.
export const parseAllowedAddresses = (raw, name) =>
  listOf(raw).map((item, index) => {
    if (net.isIP(item) === 0)
      throw new Error(`${name}: item ${index + 1} ("${item}") is not an IP address. Use exact addresses, comma-separated.`);

    return item;
  });

// Node reports an IPv4 caller on a dual-stack socket as ::ffff:1.2.3.4. Compared as written,
// an allowed 1.2.3.4 would never match.
export const plainAddress = (ip) =>
  typeof ip === "string" && ip.startsWith("::ffff:") && net.isIPv4(ip.slice(7)) ? ip.slice(7) : ip;

// Which key was given, as the first eight characters of its hash, or null. Every hash is compared
// in constant time, and all of them are compared whatever matched, so the time taken says nothing
// about how close a guess was. The id is safe to log: it cannot be turned back into the key.
export const matchingKey = (given, hashes) => {
  if (typeof given !== "string" || given === "" || given.length > MAX_KEY_LENGTH) return null;

  const candidate = Buffer.from(hashKey(given), "hex");
  let found = null;

  for (const hash of hashes)
    if (crypto.timingSafeEqual(candidate, Buffer.from(hash, "hex")) && found === null) found = hash.slice(0, 8);

  return found;
};

export default { newKey, hashKey, parseKeyHashes, parseAllowedAddresses, plainAddress, matchingKey };
