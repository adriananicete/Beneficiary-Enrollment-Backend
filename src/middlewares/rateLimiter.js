import rateLimit, { ipKeyGenerator } from "express-rate-limit";

const isDev = process.env.NODE_ENV !== "production";

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

// The IP-side guard on the two public enrollment routes, and it is volumetric
// only. It was 20 an hour, which is wrong for the shape of this system: an
// employee enrols from their company's office, so a whole company shares one
// public address. Two hundred people invited on Monday and told to enrol that
// week would have hit it at the twenty-first, and the twenty-first would have
// read "Too many requests" about something they had done once.
//
// The per-invitation limit below is what actually bounds one caller. This is
// here so a flood from one address is still refused — 300 an hour is five a
// minute, at up to 1MB each once a signature is attached.
export const mediumLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: isDev ? 2000 : 300,
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
// 100 in fifteen minutes still refuses a username sweep long before it is
// useful, because the sweep has to get past strictLimiter one username at a
// time anyway.
export const authIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 1000 : 100,
  message: {
    success: false,
    message: "Too many requests from this IP address, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});
