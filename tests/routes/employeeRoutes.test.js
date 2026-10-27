import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";

const { default: router } = await import("../../src/routes/employeeRoutes.js");
const { verifyToken } = await import("../../src/middlewares/verifyToken.js");
const { parseDocuments } = await import("../../src/middlewares/parseDocuments.js");
const { claimSubmitLimiter, messageSendLimiter, pendingCountLimiter } = await import("../../src/middlewares/rateLimiter.js");
const claims = await import("../../src/controllers/claimController.js");
const messages = await import("../../src/controllers/messageController.js");

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

  // The resubmit takes an upload too, so it gets the same order as the
  // submit, with the id checked first: a bad URL costs nothing to read.
  test("POST /claims/:claim_id/resubmit checks the id, then the limiter, then reads the upload", () => {
    const handlers = handlersFor("post", "/claims/:claim_id/resubmit");

    assert.equal(handlers[0], verifyToken);
    assert.equal(handlers.at(-1), claims.resubmitMyClaim);
    assert.equal(handlers.length, 6);

    const limiter = handlers.indexOf(claimSubmitLimiter);
    const upload = handlers.indexOf(parseDocuments);

    assert.equal(limiter, 3, "the id check sits between the role check and the limiter");
    assert.equal(upload, 4);
  });
});

// Messaging with HR, DBA request 22.
describe("the employee messaging routes", () => {
  const ROUTES = [
    ["post", "/conversation", messages.openMyConversation],
    ["get", "/conversations/unread-count", messages.getUnreadMessageCount],
    ["get", "/conversations/:conversation_id", messages.getConversation],
    ["post", "/conversations/:conversation_id/messages", messages.sendMessage],
    ["post", "/conversations/:conversation_id/read", messages.markConversationRead],
  ];

  // The role check is the second handler. Run it with each role and read
  // what it does, rather than trusting how it was built.
  const roleCheckAnswers = (handlers, role_name) => {
    let passed = false;
    let refused = null;

    handlers[1]({ user: { role_name } }, {}, (error) => {
      if (error) refused = error.statusCode;
      else passed = true;
    });

    return passed ? "passed" : refused;
  };

  for (const [method, path, controller] of ROUTES)
    test(`${method.toUpperCase()} ${path} is for employees only, behind verifyToken, and reaches its controller`, () => {
      const handlers = handlersFor(method, path);

      assert.equal(handlers[0], verifyToken);
      assert.equal(handlers.at(-1), controller);
      assert.equal(roleCheckAnswers(handlers, "Employee"), "passed");
      assert.equal(roleCheckAnswers(handlers, "HR"), 403);
    });

  test("/conversations/unread-count is declared before /conversations/:conversation_id, and rate limited", () => {
    const indexOf = (path) =>
      router.stack.findIndex((layer) => layer.route?.path === path && layer.route.methods.get);

    assert.ok(indexOf("/conversations/unread-count") < indexOf("/conversations/:conversation_id"));
    assert.ok(handlersFor("get", "/conversations/unread-count").includes(pendingCountLimiter));
  });

  test("sending is rate limited, after the id check", () => {
    const handlers = handlersFor("post", "/conversations/:conversation_id/messages");

    assert.equal(handlers.length, 6);
    assert.equal(handlers.indexOf(messageSendLimiter), 4);
  });
});
