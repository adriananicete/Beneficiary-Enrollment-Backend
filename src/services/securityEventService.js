import SecurityEventModel from "../models/securityEventModel.js";
import { AppError } from "../utils/AppError.js";
import { buildPage, parsePaging, parseSearch } from "../utils/parsePaging.js";
import { plainAddress } from "../utils/integrationKeys.js";
import { isoDateRangeOf } from "../utils/isoDate.js";

// The security event log, DBA request 28: the last item of the security
// controls list Adrian's boss sent on 2026-11-11, "structured security logs for
// authentication events, account lockouts, password resets, and other
// security-sensitive activities without exposing confidential information".
//
// What is never stored: a password, a hash, a token or a cookie. The username
// is the one typed at a sign-in. The detail is a short fixed code chosen here,
// never text from the request.

// The ten types the table's CHECK allows (CK_us09_event_type). A type outside
// it would be refused by the database, so it is refused here first.
export const SECURITY_EVENT = Object.freeze({
  LOGIN_SUCCEEDED: "LOGIN_SUCCEEDED",
  LOGIN_FAILED: "LOGIN_FAILED",
  ACCOUNT_LOCKED: "ACCOUNT_LOCKED",
  LOGIN_WHILE_LOCKED: "LOGIN_WHILE_LOCKED",
  LOGOUT: "LOGOUT",
  PASSWORD_CHANGED: "PASSWORD_CHANGED",
  PASSWORD_CHANGE_FAILED: "PASSWORD_CHANGE_FAILED",
  RESET_TOKEN_REUSED: "RESET_TOKEN_REUSED",
  CREDENTIALS_REISSUED: "CREDENTIALS_REISSUED",
  RATE_LIMITED: "RATE_LIMITED",
});

export const SECURITY_EVENT_TYPES = Object.values(SECURITY_EVENT);

// For a caller that records nothing, which is every caller that passes no
// recorder: the services keep working as they did, and their tests too.
export const NO_RECORD = () => {};

// Cut to the column's size, so a long typed username or user agent cannot make
// the insert fail and lose the event. Empty is NULL.
const fit = (value, max) => (typeof value === "string" && value !== "" ? value.slice(0, max) : null);

// The row as the procedure takes it. Exported for the tests.
export const securityEventOf = (event) => ({
  eventType: event.type,
  userId: event.userId ?? null,
  username: fit(event.username, 50),
  actorUserId: event.actorUserId ?? null,
  ipAddress: fit(plainAddress(event.ipAddress), 45),
  userAgent: fit(event.userAgent, 500),
  detail: fit(event.detail, 100),
});

// Writes one event and never fails the caller: a sign-in must not be refused
// because its log row could not be written. A failure goes to the server log,
// with the type and nothing about the person. `pool` may be a promise.
export const recordSecurityEvent = async (pool, event, { model = SecurityEventModel, log = console.error } = {}) => {
  try {
    if (!SECURITY_EVENT_TYPES.includes(event?.type)) throw new Error(`Unknown security event type: ${event?.type}`);

    await model.insertSecurityEvent(await pool, securityEventOf(event));
  } catch (error) {
    log(`Security event not recorded: ${event?.type}`, error);
  }
};

// A recorder for one request: adds where it came from. Not awaited, so writing
// the event adds no time to the answer. That matters at the login, where an
// unknown username must take as long as a wrong password (authService,
// DUMMY_HASH). The address is req.ip, so it is only as true as TRUST_PROXY.
export const recorderFor = (pool, req, deps) => (event) => {
  void recordSecurityEvent(
    pool,
    { ...event, ipAddress: req.ip, userAgent: req.headers?.["user-agent"] },
    deps,
  );
};

// ── The Administrator's list ────────────────────────────────────────────────

// ?event_type=&username=&from_date=&to_date=&page=&pageSize=. The username is a
// prefix, as the procedure matches it. Both dates are inclusive.
export const parseSecurityEventQuery = (query = {}) => {
  const eventType = query.event_type === undefined || query.event_type === "" ? null : query.event_type;

  if (eventType !== null && !SECURITY_EVENT_TYPES.includes(eventType))
    throw new AppError(`event_type must be one of ${SECURITY_EVENT_TYPES.join(", ")}`, 400);

  const username = parseSearch(query.username);
  if (username !== null && username.length > 50) throw new AppError("username can be at most 50 characters", 400);

  const { fromDate, toDate } = isoDateRangeOf(query, "from_date", "to_date");

  return { eventType, username, fromDate, toDate, ...parsePaging(query) };
};

// The paged list. The procedure refuses anyone but an Administrator (50224).
export const listSecurityEvents = async (pool, userId, query, { model = SecurityEventModel } = {}) => {
  const filters = parseSecurityEventQuery(query);
  const records = await model.getSecurityEvents(pool, userId, filters);

  return buildPage(records, filters);
};

export default {
  SECURITY_EVENT,
  SECURITY_EVENT_TYPES,
  NO_RECORD,
  recordSecurityEvent,
  recorderFor,
  parseSecurityEventQuery,
  listSecurityEvents,
};
