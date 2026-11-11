import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";

import "../helpers/env.js";

const { createAuditTrail, recordIdOf, routeKeyOf } = await import("../../src/middlewares/auditTrail.js");

// The audit middleware (DBA request 34) through a real Express app, because
// which route answered is something only Express's router knows, and when.

const CATALOG = {
  "POST /admin/companies": { object: "Company", action: "I", id: ["data.employer_id"] },
  "PATCH /admin/companies/:employer_id": { object: "Company", action: "U", id: ["param.employer_id"] },
  "DELETE /admin/companies/:employer_id": { object: "Company", action: "D", id: ["param.employer_id"] },
  "POST /admin/invitations": { object: "Invitation (bulk send)", action: "I", id: [] },
  // A read listed by mistake is still not recorded: only writes are.
  "GET /admin/companies": { object: "Company", action: "U", id: [] },
};

const recorded = [];
let server;
let base;

before(() => {
  const app = express();
  app.use(express.json());
  app.use(createAuditTrail({ poolOf: () => "pool", record: async (pool, entry) => recorded.push({ pool, entry }), catalog: CATALOG }));

  // Stands in for verifyToken: a caller unless the request says otherwise.
  const signedIn = (req, res, next) => {
    if (req.headers["x-anonymous"] !== "1") req.user = { user_id: "3" };
    next();
  };

  const admin = express.Router();
  admin.post("/companies", signedIn, (req, res) => res.status(201).json({ success: true, data: { employer_id: "9" } }));
  admin.patch("/companies/:employer_id", signedIn, (req, res) => {
    res.locals.auditEntry = { object: "Company (renamed)", oldValues: { company_name: "Old" }, newValues: { company_name: "New" } };
    res.status(200).json({ success: true });
  });
  admin.delete("/companies/:employer_id", signedIn, (req, res) => res.status(409).json({ success: false, message: "Company has enrollments" }));
  admin.post("/invitations", signedIn, (req, res) => res.status(202).json({ success: true, data: { jobId: "abc" } }));
  admin.post("/unlisted", signedIn, (req, res) => res.status(200).json({ success: true }));
  admin.get("/companies", signedIn, (req, res) => res.status(200).json({ success: true, data: [] }));
  app.use("/api/v1/admin", admin);

  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}/api/v1/admin`;
});

after(() => server.close());

// The row is written on "finish", after the answer; give it a turn.
const call = async (method, path, headers = {}) => {
  recorded.length = 0;
  const response = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", ...headers }, body: method === "GET" ? undefined : "{}" });
  await response.text();
  await new Promise((resolve) => setTimeout(resolve, 20));
  return recorded.map(({ entry }) => entry);
};

describe("the audit trail middleware", () => {
  test("a create is recorded with the id from its answer, the caller and the address", async () => {
    const [entry, ...more] = await call("POST", "/companies");

    assert.deepEqual(more, []);
    assert.equal(entry.userId, "3");
    assert.equal(entry.objectName, "Company");
    assert.equal(entry.action, "I");
    assert.equal(entry.recordId, "9");
    assert.match(String(entry.ipAddress), /127\.0\.0\.1/);
    assert.equal(entry.oldValues, undefined);
  });

  test("an update takes its id from the route, and what the handler said changed", async () => {
    const [entry] = await call("PATCH", "/companies/12");

    assert.equal(entry.recordId, "12");
    assert.equal(entry.objectName, "Company (renamed)");
    assert.deepEqual(entry.oldValues, { company_name: "Old" });
    assert.deepEqual(entry.newValues, { company_name: "New" });
  });

  test("a refused request records nothing", async () => {
    assert.deepEqual(await call("DELETE", "/companies/12"), []);
  });

  test("an action on no single record is recorded with no record id", async () => {
    const [entry] = await call("POST", "/invitations");

    assert.equal(entry.recordId, null);
    assert.equal(entry.objectName, "Invitation (bulk send)");
  });

  test("a route not in the catalog, a read, and a caller nobody signed in record nothing", async () => {
    assert.deepEqual(await call("POST", "/unlisted"), []);
    assert.deepEqual(await call("GET", "/companies"), []);
    assert.deepEqual(await call("POST", "/companies", { "x-anonymous": "1" }), []);
  });
});

describe("routeKeyOf and recordIdOf", () => {
  test("the key is the method and the declared route under /api/v1", () => {
    assert.equal(routeKeyOf({ method: "PATCH", baseUrl: "/api/v1/admin", route: { path: "/companies/:employer_id" } }), "PATCH /admin/companies/:employer_id");
    assert.equal(routeKeyOf({ method: "POST", baseUrl: "/api/v1/admin" }), null, "no route answered");
  });

  test("the first source with a whole number above zero wins", () => {
    const req = { params: { employer_id: "5", client_id: "0" } };

    assert.equal(recordIdOf(["data.claim_id", "param.employer_id"], req, { data: { claim_id: "77" } }), "77");
    assert.equal(recordIdOf(["data.claim_id", "param.employer_id"], req, { data: {} }), "5");
    assert.equal(recordIdOf(["param.client_id"], req, {}), null, "0 is not an id");
    assert.equal(recordIdOf(["data.x"], req, { data: { x: "abc" } }), null);
    assert.equal(recordIdOf([], req, {}), null);
  });
});
