import express from "express";
import { claimDetailsOn } from "../claims/detailsStore.js";
import { createIntegrationHandlers } from "../controllers/integrationController.js";
import { integrationAuth, requireScope } from "../middlewares/integrationAuth.js";
import { createFailureLimiter } from "../middlewares/integrationFailureLimiter.js";
import { onlyFromAllowedSources, requireHttps, sourceOf } from "../middlewares/integrationNetwork.js";
import { integrationLimiter } from "../middlewares/rateLimiter.js";
import { validateIdParam } from "../middlewares/validateIdParam.js";

// The hand-off API for the claims web app, mounted at /api/v1/integration by server.js
// (docs/claims-details/CONTRACT.md). Server to server: it is not behind the cookie session, which
// is applied route by route elsewhere, and it has a key of its own instead.
//
// Built from what a test replaces: the pool, and the failed-attempt limiter, so each router has its
// own count. Like src/gcli/routes.js.

// First, before the key is asked for: while CLAIM_DETAILS_DEV_STORE is off the path leaves the
// router and ends in the 404 of a path that was never declared, as developmentOnly does. A 401
// would tell a caller the API is there.
const onlyWithDetailsStore = (req, res, next) => (claimDetailsOn() ? next() : next("router"));

// Claims hold health information and identity documents: nothing here is kept by a browser, a proxy
// or the claims web app's HTTP client. After the two layers that 404, so those answers stay
// identical to a path that does not exist.
const noStore = (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  next();
};

// Every call that gets this far is logged: when, who (the key's name, or unknown), from where, what,
// and the status. Never a body, a person's name, a query string or a document. The path is read now,
// before the router changes it, and the name when the answer goes out, by which time the key has been
// looked up.
const logCall = (req, res, next) => {
  const path = req.originalUrl.split("?")[0];

  res.on("finish", () => {
    console.log(
      `${new Date().toISOString()} Integration call: ${req.integration?.name ?? "unknown key"} ${sourceOf(req)} ${req.method} ${path} ${res.statusCode}`,
    );
  });

  next();
};

export const createIntegrationRoutes = ({ getPool, failures = createFailureLimiter() }) => {
  const router = express.Router();
  const handlers = createIntegrationHandlers({ getPool });

  const claimId = validateIdParam("claim_id", "Claim not found");
  const documentId = validateIdParam("document_id", "Document not found");

  // The key check, with a refused key counted against its source in the same step it is refused.
  // Counting when the answer has been written is too late: requests pipelined down one connection
  // are all admitted before the first answer goes out.
  const authenticate = (req, res, next) =>
    integrationAuth(req, res, (error) => {
      if (error?.statusCode === 401) failures.count(req);
      next(error);
    });

  // The order is the design. A request is turned away by the first layer that has a reason, and each
  // layer says no more than it must: nothing about the API to a source that may not see it, nothing
  // about keys to a caller that is locked out, nothing about scopes to a key that is not known.
  router.use(
    onlyWithDetailsStore,
    onlyFromAllowedSources,
    noStore,
    logCall,
    requireHttps,
    failures,
    authenticate,
  );

  // What a call needs once the key is known: its scope, then its own share of the per-key limit.
  const reads = [requireScope("claims:read"), integrationLimiter];
  const transfers = [requireScope("claims:transfer"), integrationLimiter];

  router.get("/claims", ...reads, handlers.listClaims);
  router.get("/claims/:claim_id", ...reads, claimId, handlers.getClaimPackage);
  router.get("/claims/:claim_id/documents/:document_id", ...reads, claimId, documentId, handlers.downloadDocument);
  router.post("/claims/:claim_id/transfer", ...transfers, claimId, handlers.reportTransfer);
  router.post("/claims/:claim_id/outcome", ...transfers, claimId, handlers.reportOutcome);

  return router;
};

export default { createIntegrationRoutes };
