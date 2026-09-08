import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { MAX_INVITATION_EMAILS } from "../utils/partitionEmails.js";

const isDev = process.env.NODE_ENV !== "production";

// ── What the IP-keyed limits in this file can and cannot do ─────────────────
//
// They exist to refuse a flood from one address. But an employee enrols from
// their company's office and an HR user works from that same office, so **the
// legitimate users all share one address too.** That tension does not resolve
// into a better number; it resolves into knowing which limit is doing the work.
//
// The limits that actually bound abuse are the ones keyed on an IDENTITY — the
// invitation token below, `ip:username` on strictLimiter, `user_id` on the four
// HR limiters. Those bound one caller no matter where they call from.
//
// The IP ceilings are a crude backstop, set high enough that they can never
// catch legitimate traffic. **Volumetric defence belongs at the proxy in front
// of this app**, which is one of the deployment questions still open.
//
// So the numbers below are derived from the largest burst this system can
// legitimately produce, not chosen for how strict they feel.

// One HR upload creates up to MAX_INVITATION_EMAILS invitations, and every one
// of those employees may enrol the same day from the same office.
//
// Each costs at least two requests against the shared enrollment limiter — the
// lookup when they open the link, and the submit — plus refreshes and any
// submission refused by validation. Three times the cap is the honest figure.
export const ENROLLMENT_BURST = MAX_INVITATION_EMAILS * 3;

// Per fifteen minutes, so a full company's worth of first logins fits inside an
// hour. Exported for the same reason as the one above: the relationship to the
// invitation cap is the thing worth pinning, and a limiter object does not
// expose its own ceiling to a test.
export const AUTH_IP_BURST = MAX_INVITATION_EMAILS / 4;

export const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 100 : 10, // 100 sa dev, 10 sa prod
  keyGenerator: (req) =>
    `${ipKeyGenerator(req.ip)}:${req.body?.username || "unknown"}`,
  message: {
    success: false,
    message: "Too many attempts, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// The IP-side guard on the two public enrollment routes, and volumetric only.
//
// It was 20 an hour, then 300, and both were wrong for the same reason: they
// were chosen for how strict they felt rather than measured against what this
// system can legitimately produce. **HR can create a thousand invitations in
// one action**, and every one of those people may enrol the same day from the
// same office. Three hundred refuses that at a tenth of the way through.
//
// Sized from the invitation cap now, so raising `MAX_INVITATION_EMAILS` carries
// this with it instead of leaving two numbers to be kept in step by memory.
//
// The per-invitation limit below is what actually bounds one caller.
export const mediumLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: isDev ? ENROLLMENT_BURST * 5 : ENROLLMENT_BURST,
  message: {
    success: false,
    message: "Too many requests, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// The invitation token is the per-employee identity on a public route, exactly
// as user_id is on the authenticated ones — one token belongs to one person and
// can complete one enrollment.
//
// Falls back to the IP when there is no token, which is the only case this
// endpoint should ever see without one: a malformed request.
export const enrollmentTokenKey = (req) => {
  const token = req.body?.token || req.query?.token;

  return token ? `token:${token}` : ipKeyGenerator(req.ip);
};

// Stacked with mediumLimiter rather than replacing it, and the stacking is the
// point. Keyed on the token ALONE, a caller sending random tokens would open a
// fresh bucket on every request — unlimited traffic and an unbounded store,
// which is a worse hole than the one being fixed. The IP ceiling above closes
// it; this bounds what one real invitation can do.
//
// Fifteen an hour covers opening the link, a few refreshes, and several
// submissions refused by validation before one succeeds.
export const enrollmentTokenLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: isDev ? 200 : 15,
  keyGenerator: enrollmentTokenKey,
  message: {
    success: false,
    message: "Too many attempts for this invitation, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Keyed on the HR user rather than the IP. A 1,000-address upload is a rare,
// deliberate act, and keying on the user survives a reverse proxy collapsing
// every caller into one address.
export const bulkInvitationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: isDev ? 100 : 10, // 100 sa dev, 10 sa prod
  keyGenerator: (req) =>
    req.user?.user_id ? `user:${req.user.user_id}` : ipKeyGenerator(req.ip),
  message: {
    success: false,
    message: "Too many invitation uploads, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Reissuing credentials sends mail and replaces a password, so it is throttled —
// but it is a deliberate act HR performs a handful of times, not a loop.
//
// Keyed on the HR user rather than the IP, like the bulk upload above. Keying on
// the IP would put every HR user in an office behind one bucket, and strictLimiter
// cannot be reused here: it keys on req.body.username, which this endpoint does
// not carry, so every caller would collapse into "unknown".
export const credentialsResendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: isDev ? 100 : 20,
  keyGenerator: (req) =>
    req.user?.user_id ? `user:${req.user.user_id}` : ipKeyGenerator(req.ip),
  message: {
    success: false,
    message: "Too many credential resets, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// The HR screen polls the pending count every ~30s to drive a badge, so a
// 15-minute window holds about 30 requests from one correctly behaving client.
// Several HR users on one shared account, and a tab left open in more than one
// browser, are both normal — the ceiling allows for that rather than throttling
// the ordinary case.
export const pendingCountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 1000 : 300,
  keyGenerator: (req) =>
    req.user?.user_id ? `user:${req.user.user_id}` : ipKeyGenerator(req.ip),
  message: {
    success: false,
    message: "Too many status requests, please slow down.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Polling runs every ~2s while a job is in flight, so a 15-minute window can
// legitimately hold around 450 requests. The ceiling sits above that rather
// than throttling a client that is behaving correctly.
export const jobStatusLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 2000 : 600,
  keyGenerator: (req) =>
    req.user?.user_id ? `user:${req.user.user_id}` : ipKeyGenerator(req.ip),
  message: {
    success: false,
    message: "Too many status requests, please slow down.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// The IP side of the login pair. Its job is a caller trying many DIFFERENT
// usernames from one machine; a single username is already capped at ten per
// fifteen minutes by strictLimiter, which keys on ip:username.
//
// It was 30, and that is the same mistake as the enrollment one: a whole office
// signs in from one address. A batch of new employees receiving credentials on
// the same morning would have exhausted it before the thirty-first of them got
// in, and the failure reads as "too many requests" to somebody on their first
// attempt.
//
// It was raised to 100, and that was still measured against nothing. A
// thousand invited employees enrol and are then sent credentials, and a batch
// of them signing in on one morning from one office is the ordinary case, not
// the abusive one.
//
// A quarter of the invitation cap per fifteen minutes — a full company's worth
// of first logins inside an hour. It still refuses a username sweep long before
// one is useful, because the sweep has to get past strictLimiter — ten per
// fifteen minutes, keyed on ip:username — one username at a time regardless.
export const authIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? AUTH_IP_BURST * 4 : AUTH_IP_BURST,
  message: {
    success: false,
    message: "Too many requests from this IP address, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});
