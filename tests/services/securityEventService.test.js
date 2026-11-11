import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";
import { callTo, declarationOf, fakePool } from "../helpers/fakePool.js";
import { makeNext, makeReq, makeRes } from "../helpers/http.js";

const {
  SECURITY_EVENT_TYPES,
  listSecurityEvents,
  parseSecurityEventQuery,
  recordSecurityEvent,
  recorderFor,
  securityEventOf,
} = await import("../../src/services/securityEventService.js");
const { default: SecurityEventModel } = await import("../../src/models/securityEventModel.js");
const { createGetSecurityEvents } = await import("../../src/controllers/securityEventController.js");
const { sqlErrorMap } = await import("../../src/utils/sqlErrorMap.js");

// The security event log, DBA request 28: the row, the write that never fails
// its caller, and the Administrator's list.

const INSERT = "sec.us09_usp_ins_security_event";
const LIST = "sec.us09_usp_sel_security_events";

// A model that keeps what it is asked to insert.
const keepingModel = () => {
  const rows = [];
  return { rows, insertSecurityEvent: async (pool, row) => rows.push({ pool, row }) };
};

describe("the event types", () => {
  test("are exactly the ten the table's CHECK allows", () => {
    assert.deepEqual([...SECURITY_EVENT_TYPES].sort(), [
      "ACCOUNT_LOCKED",
      "CREDENTIALS_REISSUED",
      "LOGIN_FAILED",
      "LOGIN_SUCCEEDED",
      "LOGIN_WHILE_LOCKED",
      "LOGOUT",
      "PASSWORD_CHANGED",
      "PASSWORD_CHANGE_FAILED",
      "RATE_LIMITED",
      "RESET_TOKEN_REUSED",
    ]);
  });
});

describe("securityEventOf", () => {
  test("names every column, with NULL for what the event does not say", () => {
    assert.deepEqual(securityEventOf({ type: "LOGOUT", userId: 12 }), {
      eventType: "LOGOUT",
      userId: 12,
      username: null,
      actorUserId: null,
      ipAddress: null,
      userAgent: null,
      detail: null,
    });
  });

  test("cuts each text to its column, so a long one cannot lose the event", () => {
    const row = securityEventOf({
      type: "LOGIN_FAILED",
      username: "u".repeat(80),
      ipAddress: "1".repeat(60),
      userAgent: "a".repeat(900),
      detail: "d".repeat(150),
    });

    assert.equal(row.username.length, 50);
    assert.equal(row.ipAddress.length, 45);
    assert.equal(row.userAgent.length, 500);
    assert.equal(row.detail.length, 100);
  });

  test("an IPv4 caller on a dual-stack socket is stored as plain IPv4", () => {
    assert.equal(securityEventOf({ type: "LOGOUT", ipAddress: "::ffff:10.0.0.5" }).ipAddress, "10.0.0.5");
  });

  test("empty text and anything that is not text are NULL", () => {
    const row = securityEventOf({ type: "LOGIN_FAILED", username: "", userAgent: ["a"], detail: 5 });

    assert.equal(row.username, null);
    assert.equal(row.userAgent, null);
    assert.equal(row.detail, null);
  });
});

describe("recordSecurityEvent", () => {
  test("writes the row through the model, waiting for a pool still being opened", async () => {
    const model = keepingModel();
    await recordSecurityEvent(Promise.resolve("pool"), { type: "LOGOUT", userId: 12 }, { model, log: () => {} });

    assert.equal(model.rows.length, 1);
    assert.equal(model.rows[0].pool, "pool");
    assert.equal(model.rows[0].row.eventType, "LOGOUT");
  });

  test("a type the table would refuse is not sent, and is logged", async () => {
    const model = keepingModel();
    const logged = [];
    await recordSecurityEvent("pool", { type: "LOGIN_MAYBE" }, { model, log: (...args) => logged.push(args) });

    assert.equal(model.rows.length, 0);
    assert.match(logged[0][0], /LOGIN_MAYBE/);
  });

  test("a failed write never reaches the caller: it is logged, by type", async () => {
    const logged = [];
    const failing = { insertSecurityEvent: async () => Promise.reject(new Error("connection lost")) };

    await assert.doesNotReject(() =>
      recordSecurityEvent("pool", { type: "LOGIN_FAILED", username: "someone" }, { model: failing, log: (...args) => logged.push(args) }),
    );
    assert.equal(logged.length, 1);
    assert.match(logged[0][0], /LOGIN_FAILED/);
    assert.ok(!logged[0][0].includes("someone"), "the log line names the type, not the person");
  });

  test("a pool that cannot be opened is a logged failure too", async () => {
    const logged = [];
    await recordSecurityEvent(Promise.reject(new Error("no database")), { type: "LOGOUT" }, {
      model: keepingModel(),
      log: (...args) => logged.push(args),
    });

    assert.equal(logged.length, 1);
  });
});

describe("recorderFor", () => {
  test("adds the request's address and user agent, and answers nothing to wait for", async () => {
    const model = keepingModel();
    const record = recorderFor("pool", makeReq({ ip: "::ffff:10.0.0.5", headers: { "user-agent": "Mozilla/5.0" } }), {
      model,
      log: () => {},
    });

    assert.equal(record({ type: "LOGOUT", userId: 12 }), undefined);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(model.rows[0].row.ipAddress, "10.0.0.5");
    assert.equal(model.rows[0].row.userAgent, "Mozilla/5.0");
  });

  test("an event cannot name another address than the request's", async () => {
    const model = keepingModel();
    recorderFor("pool", makeReq({ ip: "10.0.0.5", headers: {} }), { model, log: () => {} })({
      type: "LOGOUT",
      ipAddress: "203.0.113.1",
    });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(model.rows[0].row.ipAddress, "10.0.0.5");
  });
});

describe("SecurityEventModel", () => {
  test("the insert binds every column, with the table's sizes", async () => {
    const { pool, calls } = fakePool({ [INSERT]: [{ security_event_id: "1" }] });
    await SecurityEventModel.insertSecurityEvent(pool, securityEventOf({ type: "LOGIN_FAILED", userId: 12, username: "EMP-020", detail: "wrong_password" }));

    const call = callTo(calls, INSERT);
    assert.deepEqual(call.inputs, {
      event_type: "LOGIN_FAILED",
      us01_user_id: 12,
      username: "EMP-020",
      actor_user_id: null,
      ip_address: null,
      user_agent: null,
      detail: "wrong_password",
    });
    for (const [name, length] of [["event_type", 40], ["username", 50], ["ip_address", 45], ["user_agent", 500], ["detail", 100]]) {
      assert.equal(declarationOf(call.bindings[name].type), "varchar", name);
      assert.equal(call.bindings[name].type.length, length, name);
    }
    assert.equal(declarationOf(call.bindings.us01_user_id.type), "bigint");
    assert.deepEqual(call.outputs, {}, "no OUTPUT parameter");
  });

  test("the list sends the caller, the filters and the page", async () => {
    const { pool, calls } = fakePool({ [LIST]: [] });
    await SecurityEventModel.getSecurityEvents(pool, 1, {
      eventType: "LOGOUT",
      username: "hr.",
      fromDate: "2026-11-01",
      toDate: "2026-11-11",
      page: 2,
      pageSize: 50,
    });

    assert.deepEqual(callTo(calls, LIST).inputs, {
      us01_user_id: 1,
      event_type: "LOGOUT",
      username: "hr.",
      from_date: "2026-11-01",
      to_date: "2026-11-11",
      page: 2,
      page_size: 50,
    });
  });
});

describe("parseSecurityEventQuery", () => {
  test("nothing given is every event, first page of 25", () => {
    assert.deepEqual(parseSecurityEventQuery({}), {
      eventType: null,
      username: null,
      fromDate: null,
      toDate: null,
      page: 1,
      pageSize: 25,
    });
  });

  test("every filter, as given", () => {
    assert.deepEqual(
      parseSecurityEventQuery({ event_type: "ACCOUNT_LOCKED", username: " hr.abcc ", from_date: "2026-11-01", to_date: "2026-11-11", page: "3", pageSize: "500" }),
      { eventType: "ACCOUNT_LOCKED", username: "hr.abcc", fromDate: "2026-11-01", toDate: "2026-11-11", page: 3, pageSize: 100 },
    );
  });

  test("a type that is not one of the ten is 400", () => {
    for (const event_type of ["login_failed", "DROP", ["LOGOUT"]])
      assert.throws(() => parseSecurityEventQuery({ event_type }), { statusCode: 400 }, JSON.stringify(event_type));
  });

  test("a username over 50 characters is 400", () => {
    assert.throws(() => parseSecurityEventQuery({ username: "u".repeat(51) }), { statusCode: 400 });
  });

  test("a date not written YYYY-MM-DD, or not on the calendar, is 400", () => {
    for (const from_date of ["11/01/2026", "2026-1-1", "2026-02-30", "2026-13-01", "yesterday", ["2026-11-01"]])
      assert.throws(() => parseSecurityEventQuery({ from_date }), { statusCode: 400 }, JSON.stringify(from_date));
  });

  test("a from_date after the to_date is 400; the same day is one day", () => {
    assert.throws(() => parseSecurityEventQuery({ from_date: "2026-11-12", to_date: "2026-11-11" }), { statusCode: 400 });
    assert.equal(parseSecurityEventQuery({ from_date: "2026-11-11", to_date: "2026-11-11" }).fromDate, "2026-11-11");
  });
});

describe("listSecurityEvents and its route", () => {
  const ROWS = [
    { security_event_id: "2", event_type: "LOGOUT", username: "EMP-020", total_count: 2 },
    { security_event_id: "1", event_type: "LOGIN_SUCCEEDED", username: "EMP-020", total_count: 2 },
  ];

  test("answers the paging envelope every list here uses", async () => {
    const asked = [];
    const model = { getSecurityEvents: async (pool, userId, filters) => (asked.push({ userId, filters }), ROWS) };

    const page = await listSecurityEvents("pool", 1, { page: "1", pageSize: "2" }, { model });

    assert.deepEqual(page, {
      rows: ROWS.map(({ total_count, ...row }) => row),
      page: 1,
      pageSize: 2,
      total: 2,
      totalPages: 1,
    });
    assert.equal(asked[0].userId, 1);
  });

  test("a bad filter is refused before the database is asked", async () => {
    const model = { getSecurityEvents: async () => assert.fail("the database was asked") };

    await assert.rejects(() => listSecurityEvents("pool", 1, { event_type: "NOPE" }, { model }), { statusCode: 400 });
  });

  test("the controller answers { success, data } for the signed-in caller", async () => {
    const res = makeRes();
    const next = makeNext();
    const seen = [];

    await createGetSecurityEvents({
      poolOf: async () => "pool",
      list: async (pool, userId, query) => (seen.push({ pool, userId, query }), { rows: [], page: 1, pageSize: 25, total: 0, totalPages: 0 }),
    })(makeReq({ user: { user_id: 1 }, query: { event_type: "LOGOUT" } }), res, next);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { success: true, data: { rows: [], page: 1, pageSize: 25, total: 0, totalPages: 0 } });
    assert.deepEqual(seen, [{ pool: "pool", userId: 1, query: { event_type: "LOGOUT" } }]);
  });

  test("50224 from the procedure is a 403", () => {
    assert.equal(sqlErrorMap[50224].statusCode, 403);
  });
});
