import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";

const { AUDITED_ROUTES, SKIPPED_ROUTES } = await import("../../src/utils/auditCatalog.js");

// Every route that writes is either audited or skipped with a reason (DBA
// request 34). What is asserted is the rule, so a write route added later
// without a decision fails here.

const MOUNTS = {
  "/auth": "authRoutes.js",
  "/enrollment": "enrollmentRoutes.js",
  "/admin": "adminRoutes.js",
  "/employee": "employeeRoutes.js",
  "/integration/ips": "ipsRoutes.js",
};

const WRITES = ["post", "put", "patch", "delete"];

const writeRoutes = [];
for (const [mount, file] of Object.entries(MOUNTS)) {
  const { default: router } = await import(`../../src/routes/${file}`);

  for (const layer of router.stack)
    if (layer.route)
      for (const method of Object.keys(layer.route.methods))
        if (WRITES.includes(method)) writeRoutes.push(`${method.toUpperCase()} ${mount}${layer.route.path}`);
}

describe("the audit catalog", () => {
  test("the routers are read: there are write routes to judge", () => {
    assert.ok(writeRoutes.length > 40, `only ${writeRoutes.length} write routes found`);
  });

  test("every write route is audited or skipped with a reason", () => {
    const undecided = writeRoutes.filter((key) => !(key in AUDITED_ROUTES) && !(key in SKIPPED_ROUTES));

    assert.deepEqual(undecided, []);
  });

  test("no route is both audited and skipped", () => {
    assert.deepEqual(Object.keys(AUDITED_ROUTES).filter((key) => key in SKIPPED_ROUTES), []);
  });

  test("every listed route exists, so a renamed one is not silently unaudited", () => {
    for (const key of [...Object.keys(AUDITED_ROUTES), ...Object.keys(SKIPPED_ROUTES)])
      assert.ok(writeRoutes.includes(key), `${key} is not a write route of the API`);
  });

  test("every entry is a module of at most 100 characters, an action I, U or D, and id sources that can be read", () => {
    for (const [key, entry] of Object.entries(AUDITED_ROUTES)) {
      assert.ok(typeof entry.object === "string" && entry.object.length > 0 && entry.object.length <= 100, key);
      assert.ok(["I", "U", "D"].includes(entry.action), key);

      for (const source of entry.id) {
        const [kind, name] = source.split(".");
        assert.ok(["data", "param"].includes(kind) && name, `${key}: ${source}`);
        if (kind === "param") assert.ok(key.includes(`:${name}`), `${key} has no :${name} parameter`);
      }
    }
  });

  test("every skip says why", () => {
    for (const [key, reason] of Object.entries(SKIPPED_ROUTES)) assert.ok(typeof reason === "string" && reason.length > 20, key);
  });

  test("the sign-ins and password changes are skipped: the security log has them", () => {
    for (const key of ["POST /auth/login", "POST /employee/login", "POST /auth/change-password", "POST /employee/change-password"])
      assert.match(SKIPPED_ROUTES[key], /security log/, key);
  });
});
