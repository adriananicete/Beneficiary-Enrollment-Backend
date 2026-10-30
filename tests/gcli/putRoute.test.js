import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";

// PUT /enrollment/application is a route only while the dev store is on, and the router reads that when
// it is first loaded: so the switch is turned on here, before the router is. Every test file runs in a
// process of its own, so this reaches no other file.
process.env.GCLI_DEV_STORE = "true";

const { default: router } = await import("../../src/routes/enrollmentRoutes.js");
const { applyInvitedEmployeeId } = await import("../../src/gcli/invitedEmployeeId.js");

const handlers = (method, path) =>
  router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method])?.route.stack.map((entry) => entry.handle);

describe("the public routes that take a form", () => {
  test("both the submit and the correction of a returned application put HR's employee ID in first", () => {
    for (const [method, path] of [["post", "/submit"], ["put", "/application"]]) {
      const chain = handlers(method, path);

      assert.ok(chain, `${method.toUpperCase()} ${path} is a route`);
      assert.equal(chain.indexOf(applyInvitedEmployeeId), 2, `${path}: straight after the two limiters`);
      assert.ok(chain.length >= 4, `${path}: with the handlers that read the form after it`);
    }
  });
});
