import { AppError } from "../utils/AppError.js";
import { matchingKey, plainAddress } from "../utils/integrationKeys.js";

// The door for IPS, another PhilLife system that reads enrollees from this API server to server
// (md/IPS-INTEGRATION-DECISIONS.md). It has no login and no session: a key in the x-api-key
// header is who it is. Replaces the teammates' version, one static key compared as plain text,
// under /admin, with no limit and no log.
//
// Built from the settings so a test can give its own. The routes put the pieces in this order,
// with the two limiters from rateLimiter.js between them:
//
//   noStore, callLog, enabled, allowedSource, ipsFailedKeyLimiter, requireKey, ipsKeyLimiter
//
// so a refusal is logged too, a server with no key set answers nothing else, and a wrong key
// counts against its address before a right one is counted against the key.

export const IPS_OFF = "Not found";
export const IPS_ADDRESS_REFUSED = "This address may not call this API.";
export const IPS_KEY_REQUIRED = "A valid API key is required.";

export const createIpsAccess = ({ keyHashes = [], allowedAddresses = [], log = console.info } = {}) => {
  // Personal data, so no copy is kept by a proxy or by the caller's HTTP cache.
  const noStore = (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  };

  // One line per call, written when the answer has gone: what was asked for, by which key, from
  // where, how it ended, and how many rows. No query string, no body and nothing about a person.
  const callLog = (req, res, next) => {
    const started = Date.now();

    res.on("finish", () =>
      log(
        `[ips] ${req.method} ${req.baseUrl}${req.path} status=${res.statusCode} key=${req.ipsKeyId ?? "none"} ` +
          `from=${plainAddress(req.ip)} rows=${res.locals?.ipsRows ?? "-"} ms=${Date.now() - started}`,
      ),
    );

    next();
  };

  // Off until a key hash is set: every route is a 404, as if it did not exist. So the server can
  // be deployed before IPS is, with nothing open.
  const enabled = (req, res, next) => next(keyHashes.length === 0 ? new AppError(IPS_OFF, 404) : undefined);

  // Only when addresses are set. req.ip is what TRUST_PROXY makes it: behind a proxy with that
  // unset, every caller is the proxy's address, and the list would allow all or nobody.
  const allowedSource = (req, res, next) =>
    next(
      allowedAddresses.length === 0 || allowedAddresses.includes(plainAddress(req.ip))
        ? undefined
        : new AppError(IPS_ADDRESS_REFUSED, 403),
    );

  // The same answer for a missing key and a wrong one.
  const requireKey = (req, res, next) => {
    const keyId = matchingKey(req.headers?.["x-api-key"], keyHashes);
    if (!keyId) return next(new AppError(IPS_KEY_REQUIRED, 401));

    req.ipsKeyId = keyId;
    next();
  };

  return { noStore, callLog, enabled, allowedSource, requireKey };
};

export default { createIpsAccess };
