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
