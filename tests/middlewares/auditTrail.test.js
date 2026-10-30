import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import "../helpers/env.js";

const { createAuditTrail, routeKeyOf, recordIdOf } = await import("../../src/middlewares/auditTrail.js");
const express = (await import("express")).default;

// The audit trail writes after the response has gone, and never changes it.
// These drive the middleware the way Express does: it is given the request and
// the response, the handler answers, the response finishes.
//
// What they cannot say is whether the database accepts the row. That is the
// procedure's business (sec.usp_ins_audit_log), and it was refusing every row
// on 2026-10-28, which only a run against the database shows.
const POOL = { pool: true };

const makeRes = (statusCode = 200) =>
  Object.assign(new EventEmitter(), {
    statusCode,
    locals: {},
    sent: [],
    json(body) {
      this.sent.push(body);
      return this;
    },
  });

const makeReq = (overrides = {}) => ({
  method: "PATCH",
  baseUrl: "/api/v1/admin",
  route: { path: "/claims/:claim_id" },
  originalUrl: "/api/v1/admin/claims/120",
  params: { claim_id: "120" },
  user: { user_id: 3, session_id: 77 },
  ip: "203.0.113.7",
  ...overrides,
});

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
};

// Runs one request through the middleware. `answer` is what the handler sends.
const run = async ({ req = makeReq(), res = makeRes(), answer = { success: true }, failWith } = {}) => {
  const inserts = [];
  const errors = [];

  const middleware = createAuditTrail({
    getPool: async () => POOL,
    insertAuditLog: async (pool, row) => {
      if (failWith) throw failWith;
      assert.equal(pool, POOL);
      inserts.push(row);
      return "1";
    },
    logError: (...args) => errors.push(args),
  });

  let nexts = 0;
  middleware(req, res, () => nexts++);

  const insertsBeforeFinish = inserts.length;
  if (answer !== undefined) res.json(answer);
  res.emit("finish");
  await flush();

  return { inserts, errors, nexts, insertsBeforeFinish, res };
};

describe("auditTrail — what it records", () => {
  test("an update: the route, the person, their session and their address", async () => {
    const { inserts } = await run();

    assert.deepEqual(inserts, [
      { userId: 3, objectName: "Claim", recordId: "120", action: "U", ipAddress: "203.0.113.7", sessionId: 77 },
    ]);
  });

  test("a create takes the id of what it made from the response", async () => {
    const { inserts } = await run({
      req: makeReq({ method: "POST", route: { path: "/companies" }, params: {} }),
      res: makeRes(201),
      answer: { success: true, data: { employer_id: 9, company_name: "X" } },
    });

    assert.equal(inserts.length, 1);
    assert.equal(inserts[0].objectName, "Company");
    assert.equal(inserts[0].action, "I");
    assert.equal(inserts[0].recordId, "9");
  });

  test("falls back to the next source when the response has none", async () => {
    const { inserts } = await run({
      req: makeReq({
        method: "POST",
        route: { path: "/enrollments/:client_id/claims" },
        params: { client_id: "55" },
      }),
      res: makeRes(201),
      answer: { success: true, data: {} },
    });

    assert.equal(inserts[0].recordId, "55");
  });

  test("a delete", async () => {
    const { inserts } = await run({
      req: makeReq({ method: "DELETE", route: { path: "/invitations/:invitation_id" }, params: { invitation_id: "8" } }),
    });

    assert.equal(inserts[0].action, "D");
    assert.equal(inserts[0].recordId, "8");
  });

  test("an action with no single record is put against the person who did it", async () => {
    const { inserts } = await run({
      req: makeReq({ method: "POST", route: { path: "/invitations" }, params: {} }),
      res: makeRes(202),
    });

    assert.equal(inserts[0].objectName, "Invitation (bulk send)");
    assert.equal(inserts[0].recordId, "3");
  });

  test("an employee's action under the employee routes", async () => {
    const { inserts } = await run({
      req: makeReq({
        method: "PATCH",
        baseUrl: "/api/v1/employee",
        route: { path: "/claims/:claim_id/cancel" },
        params: { claim_id: "31" },
        user: { user_id: 12, session_id: 90 },
      }),
    });

    assert.equal(inserts[0].userId, 12);
    assert.equal(inserts[0].sessionId, 90);
    assert.equal(inserts[0].recordId, "31");
  });

  test("a handler that says what it changed gives the row its name and its old and new values", async () => {
    const res = makeRes();
    res.locals.auditEntry = {
      object: "Profile change request (approved)",
      oldValues: { Status: "PENDING", "First Name": "Ana" },
      newValues: { Status: "APPROVED", "First Name": "Anna" },
    };

    const { inserts } = await run({
      req: makeReq({ route: { path: "/change-requests/:request_id" }, params: { request_id: "14" } }),
      res,
    });

    assert.deepEqual(inserts, [
      {
        userId: 3,
        objectName: "Profile change request (approved)",
        recordId: "14",
        action: "U",
        ipAddress: "203.0.113.7",
        sessionId: 77,
        oldValues: { Status: "PENDING", "First Name": "Ana" },
        newValues: { Status: "APPROVED", "First Name": "Anna" },
      },
    ]);
  });

  test("a handler that says nothing leaves the catalog's name, and no values to write", async () => {
    const { inserts } = await run({
      req: makeReq({ route: { path: "/change-requests/:request_id" }, params: { request_id: "14" } }),
    });

    assert.equal(inserts[0].objectName, "Profile change request");
    assert.equal("oldValues" in inserts[0], false);
    assert.equal("newValues" in inserts[0], false);
  });

  test("the address is cut to the column's 45, and is never empty", async () => {
    const long = await run({ req: makeReq({ ip: "x".repeat(60) }) });
    const none = await run({ req: makeReq({ ip: undefined }) });

    assert.equal(long.inserts[0].ipAddress.length, 45);
    assert.equal(none.inserts[0].ipAddress, "unknown");
  });
});

describe("auditTrail — what it leaves alone", () => {
  test("a read is not recorded, and its response is not touched", async () => {
    const res = makeRes();
    const json = res.json;
    const { inserts, nexts } = await run({ req: makeReq({ method: "GET" }), res });

    assert.equal(inserts.length, 0);
    assert.equal(nexts, 1);
    assert.equal(res.json, json);
  });

  for (const status of [400, 401, 403, 404, 409, 500]) {
    test(`a request that answered ${status} is not recorded`, async () => {
      const { inserts } = await run({ res: makeRes(status) });
      assert.equal(inserts.length, 0);
    });
  }

  test("a route that is not in the catalog is not recorded", async () => {
    const { inserts, errors } = await run({
      req: makeReq({ method: "POST", baseUrl: "/api/v1/auth", route: { path: "/login" }, params: {} }),
    });

    assert.equal(inserts.length, 0);
    assert.equal(errors.length, 0);
  });

  test("a request that matched no route is not recorded", async () => {
    const { inserts } = await run({ req: makeReq({ route: undefined }) });
    assert.equal(inserts.length, 0);
  });

  test("a request from nobody signed in is not recorded", async () => {
    const { inserts } = await run({ req: makeReq({ user: undefined }) });
    assert.equal(inserts.length, 0);
  });
});

describe("auditTrail — when it cannot record", () => {
  test("a person with no session is not recorded, and is said once, not on every request", async () => {
    const req = () => makeReq({ user: { user_id: 3 } });
    const errors = [];
    const middleware = createAuditTrail({
      getPool: async () => POOL,
      insertAuditLog: async () => assert.fail("nothing should be written without a session"),
      logError: (...args) => errors.push(args),
    });

    for (let i = 0; i < 3; i++) {
      const res = makeRes();
      middleware(req(), res, () => {});
      res.json({});
      res.emit("finish");
      await flush();
    }

    assert.equal(errors.length, 1);
    assert.match(errors[0][0], /user 3 has no session/);
  });

  test("a response with no usable id is said, and not recorded", async () => {
    const { inserts, errors } = await run({
      req: makeReq({ method: "POST", route: { path: "/companies" }, params: {} }),
      res: makeRes(201),
      answer: { success: true, data: { employer_id: 0 } },
    });

    assert.equal(inserts.length, 0);
    assert.match(errors[0][0], /no record id for POST \/admin\/companies/);
  });

  test("a row the database refuses is reported, and the request is not affected", async () => {
    const failWith = Object.assign(new Error("Cannot insert the value NULL into column 'us07_old_values'"), { number: 515 });
    const { errors, nexts, res } = await run({ failWith });

    assert.equal(nexts, 1);
    assert.deepEqual(res.sent, [{ success: true }]);
    assert.equal(errors.length, 1);
    assert.match(errors[0][0], /could not record PATCH \/api\/v1\/admin\/claims\/120/);
    assert.equal(errors[0][1], failWith);
  });
});

describe("auditTrail — it never gets in the way", () => {
  test("hands the request on at once and writes only after the response is done", async () => {
    const { nexts, insertsBeforeFinish, inserts } = await run();

    assert.equal(nexts, 1);
    assert.equal(insertsBeforeFinish, 0);
    assert.equal(inserts.length, 1);
  });

  test("the response goes out exactly as the handler sent it", async () => {
    const body = { success: true, data: { claim_id: 120 } };
    const { res } = await run({ answer: body });

    assert.deepEqual(res.sent, [body]);
    assert.equal(res.sent[0], body);
  });

  test("a handler that answers without JSON still gets its row, from the route", async () => {
    const { inserts } = await run({ answer: undefined });

    assert.equal(inserts[0].recordId, "120");
  });
});

describe("auditTrail — routeKeyOf", () => {
  test("is the method and the route as declared, under /api/v1", () => {
    assert.equal(
      routeKeyOf({ method: "PATCH", baseUrl: "/api/v1/admin", route: { path: "/companies/:employer_id" } }),
      "PATCH /admin/companies/:employer_id",
    );
  });

  test("has no key when no route answered, or the route is not text", () => {
    assert.equal(routeKeyOf({ method: "GET", baseUrl: "/api/v1/admin" }), null);
    assert.equal(routeKeyOf({ method: "GET", baseUrl: "/", route: { path: /x/ } }), null);
  });
});

describe("auditTrail — recordIdOf", () => {
  const req = { params: { claim_id: "120", bad: "12abc", zero: "0" }, user: { user_id: 3 } };

  test("takes the first source that is an id above zero", () => {
    assert.equal(recordIdOf(["data.x", "param.claim_id", "user"], req, { data: {} }), "120");
    assert.equal(recordIdOf(["data.x", "param.claim_id"], req, { data: { x: 5 } }), "5");
  });

  test("refuses what the procedure would refuse: zero, negatives, text and nothing", () => {
    for (const value of [0, "0", -4, "-4", "12abc", "1.5", "", null, undefined, true, {}])
      assert.equal(recordIdOf(["data.x"], { params: {} }, { data: { x: value } }), null, String(value));
  });

  test("keeps a large id as text, so it is not rounded", () => {
    assert.equal(recordIdOf(["data.x"], { params: {} }, { data: { x: "9007199254740993" } }), "9007199254740993");
  });

  test("an unknown kind of source gives nothing", () => {
    assert.equal(recordIdOf(["body.claim_id"], req, { claim_id: 5 }), null);
  });
});

// Everything above feeds the middleware a request that was written by hand. The
// one thing that matters most is not in it: that Express still knows which
// route answered, under which mount, at the moment the response finishes. So
// this one runs a real app and makes a real request.
describe("auditTrail — with Express itself", () => {
  const serve = async () => {
    const inserts = [];
    const errors = [];

    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.user = { user_id: 3, session_id: 77 };
      next();
    });
    app.use(
      createAuditTrail({
        getPool: async () => POOL,
        insertAuditLog: async (pool, row) => {
          inserts.push(row);
        },
        logError: (...args) => errors.push(args),
      }),
    );

    const router = express.Router();
    router.patch("/claims/:claim_id", (req, res) => res.status(200).json({ success: true }));
    router.post("/companies", (req, res) => res.status(201).json({ success: true, data: { employer_id: 41 } }));
    router.patch("/claims/:claim_id/close", (req, res, next) => next(new Error("boom")));
    router.get("/claims/:claim_id", (req, res) => res.status(200).json({ success: true }));
    app.use("/api/v1/admin", router);
    app.use((error, req, res, next) => res.status(500).json({ success: false }));

    const server = await new Promise((resolve) => {
      const listening = app.listen(0, () => resolve(listening));
    });

    const call = async (method, path, body) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      await response.text();
      await flush();
      return response.status;
    };

    return { inserts, errors, call, close: () => new Promise((resolve) => server.close(resolve)) };
  };

  test("records what the matched route and its mount say, and what it answered", async () => {
    const { inserts, errors, call, close } = await serve();

    try {
      assert.equal(await call("PATCH", "/api/v1/admin/claims/120", {}), 200);
      assert.equal(await call("POST", "/api/v1/admin/companies", {}), 201);

      assert.deepEqual(errors, []);
      assert.deepEqual(
        inserts.map(({ objectName, recordId, action, userId, sessionId }) => ({ objectName, recordId, action, userId, sessionId })),
        [
          { objectName: "Claim", recordId: "120", action: "U", userId: 3, sessionId: 77 },
          { objectName: "Company", recordId: "41", action: "I", userId: 3, sessionId: 77 },
        ],
      );
    } finally {
      await close();
    }
  });

  test("records nothing for a read, a failure, or a route that does not exist", async () => {
    const { inserts, call, close } = await serve();

    try {
      assert.equal(await call("GET", "/api/v1/admin/claims/120"), 200);
      assert.equal(await call("PATCH", "/api/v1/admin/claims/120/close", {}), 500);
      assert.equal(await call("PATCH", "/api/v1/admin/nothing-here", {}), 404);

      assert.deepEqual(inserts, []);
    } finally {
      await close();
    }
  });
});
