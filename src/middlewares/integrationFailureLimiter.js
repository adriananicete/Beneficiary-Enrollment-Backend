import { AppError } from "../utils/AppError.js";
import { sourceOf } from "./integrationNetwork.js";

// Counts failed authentications per source address: 20 in 15 minutes, then 429 for the rest of that
// window, even for a good key (docs/claims-details/CONTRACT.md, "Slowing guesses"). It sits on top
// of the per-key limit, to make a misconfigured or hostile caller visible and quiet.
//
// Written out rather than built on express-rate-limit's skipSuccessfulRequests, which counts a
// request when it arrives and gives the count back when it succeeds: twenty calls in flight at once
// from the claims web app (a package and its ten documents, say) would lock out their own address.
// Here only a refused key is counted, so a good call never adds to it.
//
// The count is made at the moment the 401 is decided (count(), called from the router's key check),
// not when the answer has gone out. A caller can send hundreds of requests down one connection
// before the first answer is written, and a count made on "finish" let all of them be answered 401.
//
// In memory, and so forgotten at a restart. Only listed sources get this far, so the table stays small.

export const FAILURE_LIMIT = 20;
export const FAILURE_WINDOW_MS = 15 * 60 * 1000;

export const createFailureLimiter = ({ limit = FAILURE_LIMIT, windowMs = FAILURE_WINDOW_MS, now = Date.now } = {}) => {
  // source -> { count, resetAt }
  const windows = new Map();

  const openWindow = (source) => {
    const found = windows.get(source);

    if (found && found.resetAt > now()) return found;

    windows.delete(source);
    return null;
  };

  // Before the key is looked at: a locked-out source is refused whatever it sends.
  const middleware = (req, res, next) => {
    const found = openWindow(sourceOf(req));

    if (found && found.count >= limit) {
      res.setHeader("Retry-After", Math.ceil((found.resetAt - now()) / 1000));
      return next(new AppError("Too many failed attempts from this address, please try again later.", 429));
    }

    next();
  };

  // One failed authentication from this request's source.
  middleware.count = (req) => {
    const source = sourceOf(req);
    const current = openWindow(source) ?? { count: 0, resetAt: now() + windowMs };

    current.count += 1;
    windows.set(source, current);

    // Windows that have ended are dropped as new ones are opened.
    for (const [other, entry] of windows) if (entry.resetAt <= now()) windows.delete(other);
  };

  middleware.reset = () => windows.clear();

  return middleware;
};

export default { createFailureLimiter };
