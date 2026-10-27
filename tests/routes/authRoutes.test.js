import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";

const { default: authRouter } = await import("../../src/routes/authRoutes.js");
const { default: employeeRouter } = await import("../../src/routes/employeeRoutes.js");
const { verifyResetToken } = await import("../../src/middlewares/verifyResetToken.js");
const {
  authIpLimiter,
  passwordChangeLimiter,
  strictLimiter,
} = await import("../../src/middlewares/rateLimiter.js");

// The handlers on one route, in the order Express runs them.
const handlersFor = (router, method, path) => {
  const layer = router.stack.find(
    (candidate) => candidate.route?.path === path && candidate.route.methods[method],
  );

  assert.ok(layer, `${method.toUpperCase()} ${path} is not on the router`);
  return layer.route.stack.map((entry) => entry.handle);
};

const DOORS = [
  ["admin and HR", authRouter],
  ["employee", employeeRouter],
];

for (const [door, router] of DOORS) {
  describe(`the ${door} change-password route`, () => {
    const handlers = handlersFor(router, "post", "/change-password");

    // strictLimiter keys on req.body.username, which this body does not carry,
    // so it counted a whole office as one caller. Found 2026-10-06.
    test("is not behind strictLimiter", () => {
      assert.ok(!handlers.includes(strictLimiter));
    });

    test("is behind passwordChangeLimiter", () => {
      assert.ok(handlers.includes(passwordChangeLimiter));
    });

    // The limiter reads the username from the reset token, and the token is
    // read by verifyResetToken. In the other order every request keys on the
    // address and the defect is back.
    test("checks the reset token before the limiter that counts by it", () => {
      assert.ok(handlers.includes(verifyResetToken));
      assert.ok(
        handlers.indexOf(verifyResetToken) < handlers.indexOf(passwordChangeLimiter),
        "passwordChangeLimiter runs before verifyResetToken",
      );
    });

    // The address ceiling stays first, so requests with no token at all are
    // still bounded.
    test("keeps the address ceiling in front of everything", () => {
      assert.equal(handlers.indexOf(authIpLimiter), 0);
    });
  });

  describe(`the ${door} login route`, () => {
    // The login body does carry the username, so strictLimiter stays here.
    test("is still behind both login limiters", () => {
      const handlers = handlersFor(router, "post", "/login");

      assert.ok(handlers.includes(authIpLimiter));
      assert.ok(handlers.includes(strictLimiter));
    });
  });
}
