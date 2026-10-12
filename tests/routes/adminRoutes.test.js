import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";

const { default: router } = await import("../../src/routes/adminRoutes.js");
const { verifyToken } = await import("../../src/middlewares/verifyToken.js");
const { getEmployerSettings, updateEmployerSettings } = await import(
  "../../src/controllers/employerSettingsController.js"
);
const claims = await import("../../src/controllers/claimController.js");
const messages = await import("../../src/controllers/messageController.js");
const { messageSendLimiter, pendingCountLimiter } = await import("../../src/middlewares/rateLimiter.js");

const handlersFor = (method, path) => {
  const layer = router.stack.find(
    (candidate) => candidate.route?.path === path && candidate.route.methods[method],
  );

  assert.ok(layer, `${method.toUpperCase()} ${path} is not on the router`);
  return layer.route.stack.map((entry) => entry.handle);
};

// The per-company settings, DBA request 19. The procedures scope HR to their
// own company, but only for a caller who got past the session check first.
describe("the employer settings routes", () => {
  test("GET /employers/settings is behind verifyToken and reaches its controller", () => {
    const handlers = handlersFor("get", "/employers/settings");

    assert.equal(handlers[0], verifyToken);
    assert.equal(handlers.at(-1), getEmployerSettings);
  });

  // verifyToken, the role check, the id check, then the controller. The id
  // check is what turns /employers/abc/settings into a 404 rather than a
  // driver error.
  test("PATCH /employers/:employer_id/settings is behind verifyToken, a role check and an id check", () => {
    const handlers = handlersFor("patch", "/employers/:employer_id/settings");

    assert.equal(handlers[0], verifyToken);
    assert.equal(handlers.length, 4);
    assert.equal(handlers.at(-1), updateEmployerSettings);
  });
});

// HR's claim review, branch 4. The procedures scope HR to their own
// companies, for a caller who got past the session and the role first.
describe("the HR claim routes", () => {
  const ROUTES = [
    ["get", "/claims", claims.getClaims],
    ["get", "/claims/pending-count", claims.getPendingClaimCount],
    ["get", "/claims/:claim_id", claims.getClaimDetails],
    ["get", "/claims/:claim_id/documents/:document_id", claims.getClaimDocument],
    ["patch", "/claims/:claim_id", claims.reviewClaim],
  ];

  for (const [method, path, controller] of ROUTES)
    test(`${method.toUpperCase()} ${path} is behind verifyToken and a role check, and reaches its controller`, () => {
      const handlers = handlersFor(method, path);

      assert.equal(handlers[0], verifyToken);
      assert.ok(handlers.length >= 3, "no role check");
      assert.equal(handlers.at(-1), controller);
    });

  // Express matches in order. Declared after /:claim_id, the badge would be
  // read as a claim id called "pending-count" and answer 404.
  test("/claims/pending-count is declared before /claims/:claim_id", () => {
    const indexOf = (path) =>
      router.stack.findIndex((layer) => layer.route?.path === path && layer.route.methods.get);

    assert.ok(indexOf("/claims/pending-count") < indexOf("/claims/:claim_id"));
  });

  test("the badge is rate limited", () => {
    assert.ok(handlersFor("get", "/claims/pending-count").includes(pendingCountLimiter));
  });

  // The id checks turn /claims/abc into a 404 rather than a driver error.
  test("every route with an id in the path checks it", () => {
    assert.equal(handlersFor("get", "/claims/:claim_id").length, 4);
    assert.equal(handlersFor("patch", "/claims/:claim_id").length, 4);
    assert.equal(handlersFor("get", "/claims/:claim_id/documents/:document_id").length, 5);
  });
});

// Messaging, DBA request 22. HR only: the Administrator has no access in v1.
describe("the HR messaging routes", () => {
  const ROUTES = [
    ["get", "/conversations", messages.getConversations],
    ["post", "/conversations", messages.openConversation],
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
    test(`${method.toUpperCase()} ${path} is for HR only, behind verifyToken, and reaches its controller`, () => {
      const handlers = handlersFor(method, path);

      assert.equal(handlers[0], verifyToken);
      assert.equal(handlers.at(-1), controller);
      assert.equal(roleCheckAnswers(handlers, "HR"), "passed");
      assert.equal(roleCheckAnswers(handlers, "Administrator"), 403);
      assert.equal(roleCheckAnswers(handlers, "Employee"), 403);
    });

  test("/conversations/unread-count is declared before /conversations/:conversation_id, and rate limited", () => {
    const indexOf = (path) =>
      router.stack.findIndex((layer) => layer.route?.path === path && layer.route.methods.get);

    assert.ok(indexOf("/conversations/unread-count") < indexOf("/conversations/:conversation_id"));
    assert.ok(handlersFor("get", "/conversations/unread-count").includes(pendingCountLimiter));
  });

  test("sending is rate limited, after the id check", () => {
    const handlers = handlersFor("post", "/conversations/:conversation_id/messages");

    assert.equal(handlers.length, 5);
    assert.equal(handlers.indexOf(messageSendLimiter), 3);
  });
});
