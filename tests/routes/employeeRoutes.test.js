import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";

const { default: router } = await import("../../src/routes/employeeRoutes.js");
const { verifyToken } = await import("../../src/middlewares/verifyToken.js");
const { parseDocuments } = await import("../../src/middlewares/parseDocuments.js");
const { claimSubmitLimiter } = await import("../../src/middlewares/rateLimiter.js");
const claims = await import("../../src/controllers/claimController.js");

const handlersFor = (method, path) => {
  const layer = router.stack.find(
    (candidate) => candidate.route?.path === path && candidate.route.methods[method],
  );

  assert.ok(layer, `${method.toUpperCase()} ${path} is not on the router`);
  return layer.route.stack.map((entry) => entry.handle);
};

// The employee's claim routes, branch 3. Each is behind the session check,
// and each ends in its own controller.
describe("the employee claim routes", () => {
  const ROUTES = [
    ["get", "/claim-types", claims.getMyClaimTypes],
    ["post", "/claims", claims.submitMyClaim],
    ["get", "/claims", claims.getMyClaims],
    ["get", "/claims/:claim_id", claims.getMyClaim],
    ["get", "/claims/:claim_id/documents/:document_id", claims.getMyClaimDocument],
    ["patch", "/claims/:claim_id/cancel", claims.cancelMyClaim],
  ];

  for (const [method, path, controller] of ROUTES)
    test(`${method.toUpperCase()} ${path} is behind verifyToken and reaches its controller`, () => {
      const handlers = handlersFor(method, path);

      assert.equal(handlers[0], verifyToken);
      assert.equal(handlers.at(-1), controller);
    });

  // The order is the point. parseDocuments holds up to ten 5MB files in
  // memory. Ahead of verifyToken, anybody could make the server buffer 50MB
  // per request without signing in; ahead of the limiter, a caller over the
  // limit would still be read in full before being refused.
  test("POST /claims reads the upload only after the session, the role and the limiter", () => {
    const handlers = handlersFor("post", "/claims");

    const session = handlers.indexOf(verifyToken);
    const limiter = handlers.indexOf(claimSubmitLimiter);
    const upload = handlers.indexOf(parseDocuments);

    assert.equal(session, 0);
    assert.ok(limiter > session, "the limiter runs after the session check");
    assert.ok(upload > limiter, "the upload is parsed after the limiter");
    assert.equal(upload, handlers.length - 2, "the upload is parsed last, just before the controller");
  });

  // Only the submit takes an upload.
  test("no other claim route parses an upload", () => {
    const others = ROUTES.filter(([method, path]) => !(method === "post" && path === "/claims"));

    for (const [method, path] of others)
      assert.equal(handlersFor(method, path).includes(parseDocuments), false, `${method} ${path}`);
  });

  // The id checks turn /claims/abc into a 404 rather than a driver error.
  test("every route with an id in the path checks it before the controller", () => {
    assert.equal(handlersFor("get", "/claims/:claim_id").length, 4);
    assert.equal(handlersFor("get", "/claims/:claim_id/documents/:document_id").length, 5);
    assert.equal(handlersFor("patch", "/claims/:claim_id/cancel").length, 4);
  });
});
