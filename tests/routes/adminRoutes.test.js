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
const deceased = await import("../../src/controllers/deceasedController.js");
const { verifyClientAccess } = await import("../../src/middlewares/verifyClientAccess.js");
const { claimSubmitLimiter, messageSendLimiter, pendingCountLimiter } = await import("../../src/middlewares/rateLimiter.js");
const { parseDocuments } = await import("../../src/middlewares/parseDocuments.js");

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

// Run the role check (the second handler) with a role, and read what it did.
const roleAnswer = (handlers, role_name) => {
  let answer = null;

  handlers[1]({ user: { role_name } }, {}, (error) => {
    answer = error ? error.statusCode : "passed";
  });

  return answer;
};

// Deceased status, DBA request 21. HR and the Administrator mark; only the
// Administrator undoes (decided 2026-10-06).
describe("the deceased routes", () => {
  test("POST marks, for HR and the Administrator, behind verifyToken and verifyClientAccess", () => {
    const handlers = handlersFor("post", "/enrollments/:client_id/deceased");

    assert.equal(handlers[0], verifyToken);
    assert.equal(handlers[2], verifyClientAccess);
    assert.equal(handlers.at(-1), deceased.markDeceased);
    assert.equal(roleAnswer(handlers, "HR"), "passed");
    assert.equal(roleAnswer(handlers, "Administrator"), "passed");
    assert.equal(roleAnswer(handlers, "Employee"), 403);
  });

  test("DELETE undoes, for the Administrator only", () => {
    const handlers = handlersFor("delete", "/enrollments/:client_id/deceased");

    assert.equal(handlers[0], verifyToken);
    assert.equal(handlers[2], verifyClientAccess);
    assert.equal(handlers.at(-1), deceased.undoDeceased);
    assert.equal(roleAnswer(handlers, "Administrator"), "passed");
    assert.equal(roleAnswer(handlers, "HR"), 403);
    assert.equal(roleAnswer(handlers, "Employee"), 403);
  });
});

// The death claim, DBA request 21. HR and the Administrator.
describe("the death claim routes", () => {
  test("GET /claim-types gives HR's types, for HR and the Administrator", () => {
    const handlers = handlersFor("get", "/claim-types");

    assert.equal(handlers[0], verifyToken);
    assert.equal(handlers.at(-1), claims.getHrClaimTypes);
    assert.equal(roleAnswer(handlers, "HR"), "passed");
    assert.equal(roleAnswer(handlers, "Administrator"), "passed");
    assert.equal(roleAnswer(handlers, "Employee"), 403);
  });

  // The upload is read last, after the session, the role, the company and
  // the limiter, so nobody outside the company gets 50MB held in memory.
  test("POST /enrollments/:client_id/death-claim checks the company and the limiter before reading the upload", () => {
    const handlers = handlersFor("post", "/enrollments/:client_id/death-claim");

    assert.equal(handlers[0], verifyToken);
    assert.equal(roleAnswer(handlers, "HR"), "passed");
    assert.equal(roleAnswer(handlers, "Employee"), 403);
    assert.equal(handlers[2], verifyClientAccess);
    assert.equal(handlers[3], claimSubmitLimiter);
    assert.equal(handlers[4], parseDocuments);
    assert.equal(handlers.at(-1), claims.fileDeathClaim);
  });

  test("PATCH /claims/:claim_id/close checks the id, for HR and the Administrator", () => {
    const handlers = handlersFor("patch", "/claims/:claim_id/close");

    assert.equal(handlers[0], verifyToken);
    assert.equal(handlers.length, 4);
    assert.equal(handlers.at(-1), claims.closeDeathClaim);
    assert.equal(roleAnswer(handlers, "HR"), "passed");
    assert.equal(roleAnswer(handlers, "Administrator"), "passed");
    assert.equal(roleAnswer(handlers, "Employee"), 403);
  });
});

// The Administrator's companies, DBA request 24. The Administrator only; HR
// keeps its own settings route.
describe("the company routes", () => {
  const ROUTES = [
    ["get", "/companies", "getCompanies", 3],
    ["post", "/companies", "createCompany", 4],
    ["get", "/companies/:employer_id", "getCompany", 4],
    ["patch", "/companies/:employer_id", "updateCompany", 5],
  ];

  for (const [method, path, controllerName, length] of ROUTES)
    test(`${method.toUpperCase()} ${path} is for the Administrator only, behind verifyToken, and reaches its controller`, async () => {
      const controllers = await import("../../src/controllers/companyController.js");
      const handlers = handlersFor(method, path);

      assert.equal(handlers[0], verifyToken);
      assert.equal(handlers.at(-1), controllers[controllerName]);
      assert.equal(handlers.length, length);
      assert.equal(roleAnswer(handlers, "Administrator"), "passed");
      assert.equal(roleAnswer(handlers, "HR"), 403);
      assert.equal(roleAnswer(handlers, "Employee"), 403);
    });

  // The body is checked before the controller, and on the PATCH after the id
  // check, so /companies/abc is a 404 before anything is read.
  test("the validators run before the controllers", async () => {
    const { validateCompanyChanges, validateNewCompany } = await import("../../src/middlewares/validateCompany.js");

    assert.equal(handlersFor("post", "/companies")[2], validateNewCompany);
    assert.equal(handlersFor("patch", "/companies/:employer_id")[3], validateCompanyChanges);
  });
});

// HR's own company's classifications, DBA request 23. HR only, like the
// invitation routes: they are what HR assigns on each invitation.
describe("the HR classification route", () => {
  test("GET /classifications is for HR only, behind verifyToken, and reaches its controller", async () => {
    const { getCompanyClassifications } = await import("../../src/controllers/adminController.js");
    const handlers = handlersFor("get", "/classifications");

    assert.equal(handlers[0], verifyToken);
    assert.equal(handlers.at(-1), getCompanyClassifications);
    assert.equal(roleAnswer(handlers, "HR"), "passed");
    assert.equal(roleAnswer(handlers, "Administrator"), 403);
    assert.equal(roleAnswer(handlers, "Employee"), 403);
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
