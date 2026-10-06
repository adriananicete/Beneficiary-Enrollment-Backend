import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";

const { default: router } = await import("../../src/routes/adminRoutes.js");
const { verifyToken } = await import("../../src/middlewares/verifyToken.js");
const { getEmployerSettings, updateEmployerSettings } = await import(
  "../../src/controllers/employerSettingsController.js"
);

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
