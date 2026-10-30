import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";

const { AUDITED_ROUTES, SKIPPED_ROUTES } = await import("../../src/utils/auditCatalog.js");
const { default: adminRoutes } = await import("../../src/routes/adminRoutes.js");
const { default: employeeRoutes } = await import("../../src/routes/employeeRoutes.js");
const { default: authRoutes } = await import("../../src/routes/authRoutes.js");
const { default: enrollmentRoutes } = await import("../../src/routes/enrollmentRoutes.js");
const { createGcliRoutes } = await import("../../src/gcli/routes.js");

// The audit trail only records a route that is listed. Without this a new
// endpoint is unaudited until somebody notices, which is the way an audit trail
// stops being one. A route has to be in AUDITED_ROUTES or, with the reason, in
// SKIPPED_ROUTES.
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const gcliRoutes = createGcliRoutes({ verifyToken: () => {}, getPool: async () => ({}) });

const MOUNTED = [
  ["admin", adminRoutes],
  ["admin", gcliRoutes],
  ["employee", employeeRoutes],
  ["auth", authRoutes],
  ["enrollment", enrollmentRoutes],
];

const mutatingRoutes = MOUNTED.flatMap(([area, router]) =>
  router.stack
    .filter((layer) => layer.route)
    .flatMap((layer) =>
      Object.keys(layer.route.methods)
        .map((method) => method.toUpperCase())
        .filter((method) => MUTATING.has(method))
        .map((method) => `${method} /${area}${layer.route.path}`),
    ),
);

describe("auditCatalog — every route that changes something is accounted for", () => {
  test("the routers were read (a guard against this test passing on nothing)", () => {
    assert.ok(mutatingRoutes.length > 40, `only ${mutatingRoutes.length} mutating routes found`);
  });

  test("each is audited or skipped for a stated reason", () => {
    const missing = mutatingRoutes.filter((key) => !(key in AUDITED_ROUTES) && !(key in SKIPPED_ROUTES));

    assert.deepEqual(missing, [], `not in the audit catalog: ${missing.join(", ")}`);
  });

  test("none is both", () => {
    const both = Object.keys(AUDITED_ROUTES).filter((key) => key in SKIPPED_ROUTES);

    assert.deepEqual(both, []);
  });

  // The enrollment correction route exists only while the dev store is on, so
  // a skipped route may be absent. An audited one that is absent is a typo or a
  // route that was renamed, and would record nothing.
  test("every audited entry is a real route", () => {
    const unknown = Object.keys(AUDITED_ROUTES).filter((key) => !mutatingRoutes.includes(key));

    assert.deepEqual(unknown, [], `audited, but no such route: ${unknown.join(", ")}`);
  });

  test("every skipped entry says why", () => {
    for (const [key, reason] of Object.entries(SKIPPED_ROUTES))
      assert.ok(typeof reason === "string" && reason.length > 10, key);
  });
});

describe("auditCatalog — each entry says what the procedure will accept", () => {
  const entries = Object.entries(AUDITED_ROUTES);

  test("the action is I, U or D: it refuses anything else, L included", () => {
    for (const [key, { action }] of entries) assert.match(action, /^[IUD]$/, key);
  });

  test("a delete is recorded as D, and D only for a delete or the development wipe", () => {
    for (const [key, { action }] of entries) {
      if (key.startsWith("DELETE ")) assert.equal(action, "D", key);
      else if (action === "D") assert.equal(key, "POST /admin/enrollments/wipe");
    }
  });

  test("the object name is there and fits the column's 100", () => {
    for (const [key, { object }] of entries) {
      assert.ok(object && object.length <= 100, key);
    }
  });

  test("there is a way to find a record id, and a route parameter it names is on the route", () => {
    for (const [key, { id }] of entries) {
      assert.ok(Array.isArray(id) && id.length > 0, `${key} has no source for the record id`);

      for (const source of id) {
        assert.match(source, /^(user|param\.\w+|data\.\w+)$/, `${key}: ${source}`);

        if (source.startsWith("param."))
          assert.ok(key.includes(`:${source.slice(6)}`), `${key} has no :${source.slice(6)} parameter`);
      }
    }
  });

  test("a create finds the id it made in the response before anything else", () => {
    // An id taken from the URL on a create would be the parent's, not the new record's.
    for (const [key, { action, id }] of entries) {
      if (key.startsWith("POST ") && action === "I" && id.length > 1)
        assert.ok(id[0].startsWith("data."), `${key} reads ${id[0]} first`);
    }
  });
});
