import express from "express";
import config from "../config/env.js";
import { createIpsAccess } from "../middlewares/ipsAccess.js";
import { ipsFailedKeyLimiter, ipsKeyLimiter } from "../middlewares/rateLimiter.js";
import { getIpsCompanies } from "../controllers/ipsController.js";

// IPS, server to server, mounted at /api/v1/integration/ips. GET only. Every route goes through
// the whole gate, in this order (src/middlewares/ipsAccess.js says why); exported so the route
// test can hold every route to it.
const access = createIpsAccess(config.ips);

export const ipsGate = [
  access.noStore,
  access.callLog,
  access.enabled,
  access.allowedSource,
  ipsFailedKeyLimiter,
  access.requireKey,
  ipsKeyLimiter,
];

const router = express.Router();

router.get("/companies", ...ipsGate, getIpsCompanies);

export default router;
