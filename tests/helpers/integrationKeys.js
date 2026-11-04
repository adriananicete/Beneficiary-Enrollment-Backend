// Entries for INTEGRATION_API_KEY_HASHES, built the way the server reads them, so a test writes the
// key it presents and the setting follows from it.
import crypto from "node:crypto";

export const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

export const BOTH_SCOPES = "claims:read+claims:transfer";

// Far enough away that no test run meets it.
export const FAR_FUTURE = "2099-12-31";

export const entry = (name, key, { scopes = BOTH_SCOPES, expires = FAR_FUTURE } = {}) =>
  `${name}:${sha256(key)}:${scopes}:${expires}`;

export const setting = (...entries) => entries.join(",");

export default { sha256, entry, setting, BOTH_SCOPES, FAR_FUTURE };
