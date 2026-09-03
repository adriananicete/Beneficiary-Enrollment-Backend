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

export const mediumLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: isDev ? 200 : 20, // 200 sa dev, 20 sa prod
  message: {
    success: false,
    message: "Too many requests, please try again later.",
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

export const authIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 300 : 30,  // 300 sa dev, 30 sa prod
  message: {
    success: false,
    message: "Too many requests from this IP address, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});
