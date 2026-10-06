import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";

const { default: router } = await import("../../src/routes/enrollmentRoutes.js");
const limiters = await import("../../src/middlewares/rateLimiter.js");

// The public router: no session and no account. Every route here is reachable
// by anybody, and until 2026-10-06 six of its eight had no rate limit, which a
// pentest reports. What is asserted is the rule, so a route added later without
// a limiter fails here rather than in the next pentest.

const routes = router.stack
  .filter((layer) => layer.route)
  .map(({ route }) => ({
    label: `${Object.keys(route.methods).join(",").toUpperCase()} ${route.path}`,
    path: route.path,
    handlers: route.stack.map((layer) => layer.handle),
  }));

// Every export named *Limiter. The key generators are exported too and are
// not limiters.
const allLimiters = Object.entries(limiters)
  .filter(([name]) => name.endsWith("Limiter"))
  .map(([, limiter]) => limiter);

const REFERENCE_PATHS = [
  "/classifications",
  "/employers",
  "/regions",
  "/regions/:region_code/provinces",
  "/provinces/:province_code/cities",
  "/cities/:city_code/barangays",
];

describe("the public enrollment routes", () => {
  test("the router is read correctly: all eight routes are found", () => {
    assert.equal(routes.length, 8, routes.map((route) => route.label).join(" | "));
  });

  test("every route has a rate limiter", () => {
    for (const route of routes)
      assert.ok(
        route.handlers.some((handler) => allLimiters.includes(handler)),
        `${route.label} has no rate limiter`,
      );
  });

  // The same instance on all six, so they share one budget. Six separate
  // limiters would give a caller six times the ceiling.
  test("the six reference routes share the one reference limiter", () => {
    for (const path of REFERENCE_PATHS) {
      const route = routes.find((candidate) => candidate.path === path);

      assert.ok(route, `${path} is not on the router`);
      assert.ok(
        route.handlers.includes(limiters.referenceLimiter),
        `${path} is not behind referenceLimiter`,
      );
    }
  });

  // And it runs before the controller, or it would limit nothing.
  test("the limiter comes before the controller on every reference route", () => {
    for (const path of REFERENCE_PATHS) {
      const { handlers } = routes.find((candidate) => candidate.path === path);

      assert.equal(handlers.indexOf(limiters.referenceLimiter), 0, path);
    }
  });
});
