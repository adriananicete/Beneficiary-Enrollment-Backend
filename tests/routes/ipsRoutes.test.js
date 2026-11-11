import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";

const { default: router, ipsGate } = await import("../../src/routes/ipsRoutes.js");
const limiters = await import("../../src/middlewares/rateLimiter.js");

// IPS, server to server (md/IPS-INTEGRATION-DECISIONS.md). What is asserted is the rule, so a
// route added later without the whole gate, or with its pieces moved, fails here.

const routes = router.stack
  .filter((layer) => layer.route)
  .map(({ route }) => ({
    label: `${Object.keys(route.methods).join(",").toUpperCase()} ${route.path}`,
    methods: Object.keys(route.methods),
    handlers: route.stack.map((layer) => layer.handle),
  }));

describe("the IPS routes", () => {
  test("the router is read correctly: the one route of branch 1 is found", () => {
    assert.deepEqual(
      routes.map((route) => route.label),
      ["GET /companies"],
    );
  });

  test("GET only: IPS reads, it never writes", () => {
    for (const route of routes) assert.deepEqual(route.methods, ["get"], route.label);
  });

  test("every route starts with the whole gate, in order, and ends with its controller", () => {
    for (const route of routes) {
      assert.deepEqual(route.handlers.slice(0, ipsGate.length), ipsGate, route.label);
      assert.equal(route.handlers.length, ipsGate.length + 1, `${route.label} has something besides the gate and its controller`);
    }
  });

  // The order is the design: the wrong-key limiter must see the request before the key check
  // refuses it, and the per-key limiter needs the key the check found.
  test("the two limiters sit either side of the key check", () => {
    const failed = ipsGate.indexOf(limiters.ipsFailedKeyLimiter);
    const perKey = ipsGate.indexOf(limiters.ipsKeyLimiter);

    assert.ok(failed >= 0 && perKey >= 0, "both limiters are in the gate");
    assert.equal(perKey - failed, 2, "exactly the key check between them");
  });
});
