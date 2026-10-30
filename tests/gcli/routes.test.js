import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

import "../helpers/env.js";
import { fakePool } from "../helpers/fakePool.js";
import { silenceConsoleError } from "../helpers/http.js";
import { CREDIT_PLAN, LIMITS, useDevStore } from "../helpers/gcliStore.js";

const { createGcliRoutes } = await import("../../src/gcli/routes.js");
const { errorHandler } = await import("../../src/middlewares/errorHandler.js");
const { AppError } = await import("../../src/utils/AppError.js");
const { savePlan } = await import("../../src/gcli/companies.js");
const { submitApplication } = await import("../../src/gcli/applications.js");

// The routes Group Credit Life adds, behind a stand-in for the session check, over HTTP: what
// the frontend sends and reads (docs/backend-handoff.md 2.12). The session is the
// x-user header; HR "5" is Bluepoint's (company 2), HR "6" is another company's (7).

const USERS = {
  hr: { user_id: "5", username: "hr.bluepoint", role_name: "HR" },
  otherHr: { user_id: "6", username: "hr.other", role_name: "HR" },
  admin: { user_id: "1", username: "admin", role_name: "Administrator" },
  employee: { user_id: "9", username: "EMP-1", role_name: "Employee" },
};

const verifyToken = (req, res, next) => {
  const header = req.headers["x-user"];
  if (!header) return next(new AppError("Unauthorized: No token provided.", 401));
  req.user = USERS[header];
  next();
};

const pool = fakePool({
  "sec.us08_usp_sel_employers_by_user": (inputs) => ({
    recordset: [{ employer_id: inputs.us01_user_id === "5" ? "2" : "7" }],
    output: {},
  }),
}, [[/ref_plans/, [
  { plan_id: "2", plan_code: "GCLIP", plan_desc: "Group Credit Life Insurance Plan", template: "G-CLI", is_active: false },
  { plan_id: "3", plan_code: "GTLIP", plan_desc: "Group Term Life Insurance Plan", template: "G-TLI", is_active: true },
]]]).pool;

let server;
let base;
let restoreConsole;

before(async () => {
  restoreConsole = silenceConsoleError();
  const app = express();
  app.use(express.json());
  app.use("/api/v1/admin", createGcliRoutes({ verifyToken, getPool: async () => pool }));
  app.use(errorHandler);

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1/admin`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  restoreConsole();
});

const call = async (method, path, { as, body } = {}) => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(as ? { "x-user": as } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json().catch(() => null) };
};

const borrower = (letter, id, overrides = {}) => ({
  token: letter.repeat(64),
  employee_id_number: id,
  first_name: "Ana",
  middle_name: "",
  last_name: "Reyes",
  suffix: "",
  address_line: "27 Mabini St",
  barangay_id: "012801001",
  zip_code: "1100",
  birthdate: "1992-03-14",
  contact_no: "09171234567",
  loan: { loan_reference: "BP-1", purpose: "Salary loan", loan_amount: 850000, term_months: 36, release_date: "2026-11-02" },
  ...overrides,
});

const apply = (letter, id, company = "2", overrides) =>
  submitApplication({
    invitation: { employer_id: company, company_name: "Bluepoint Lending Corporation", email_address: `${id}@example.com` },
    body: borrower(letter, id, overrides),
  });

const FIRST = "900000000001";

describe("GET /plans", () => {
  useDevStore();

  test("is the Administrator's, and lists every plan with the credit plan switched on", async () => {
    const { status, json } = await call("GET", "/plans", { as: "admin" });

    assert.equal(status, 200);
    assert.equal(json.success, true);
    assert.deepEqual(json.data.map((plan) => [plan.plan_code, plan.template, plan.is_active]), [["GCLIP", "G-CLI", true], ["GTLIP", "G-TLI", true]]);
  });

  test("is not HR's or an employee's, and needs a session", async () => {
    assert.equal((await call("GET", "/plans", { as: "hr" })).status, 403);
    assert.equal((await call("GET", "/plans", { as: "employee" })).status, 403);
    assert.equal((await call("GET", "/plans")).status, 401);
  });
});

describe("the approvals queue", () => {
  useDevStore();

  const seed = () => {
    savePlan("2", { plan: CREDIT_PLAN, loan_limits: LIMITS });
    savePlan("7", { plan: CREDIT_PLAN, loan_limits: LIMITS });
    apply("a", "EMP-1");
    apply("b", "EMP-2");
    apply("c", "EMP-3", "7");
  };

  test("is HR's alone", async () => {
    seed();
    for (const [method, path] of [["GET", "/enrollment-approvals"], ["GET", "/enrollment-approvals/pending-count"], ["GET", `/enrollment-approvals/${FIRST}`], ["POST", `/enrollment-approvals/${FIRST}/approve`]]) {
      assert.equal((await call(method, path, { as: "admin" })).status, 403, `${method} ${path} as the Administrator`);
      assert.equal((await call(method, path, { as: "employee" })).status, 403, `${method} ${path} as an employee`);
      assert.equal((await call(method, path)).status, 401, `${method} ${path} with no session`);
    }
  });

  test("lists the waiting ones of HR's own company in the paged shape", async () => {
    seed();
    const { status, json } = await call("GET", "/enrollment-approvals?status=waiting&page=1&pageSize=100", { as: "hr" });

    assert.equal(status, 200);
    assert.equal(json.data.total, 2);
    assert.deepEqual(Object.keys(json.data).sort(), ["page", "pageSize", "rows", "total", "totalPages"]);
    assert.deepEqual(json.data.rows.map((row) => row.employee_id_number).sort(), ["EMP-1", "EMP-2"]);

    const other = await call("GET", "/enrollment-approvals?status=waiting", { as: "otherHr" });
    assert.deepEqual(other.json.data.rows.map((row) => row.employee_id_number), ["EMP-3"]);
  });

  test("a status that is not a tab is 400, and none at all means waiting", async () => {
    seed();
    assert.equal((await call("GET", "/enrollment-approvals?status=all", { as: "hr" })).status, 400);
    assert.equal((await call("GET", "/enrollment-approvals", { as: "hr" })).json.data.total, 2);
  });

  test("the count is a number in data, and is not mistaken for an application id", async () => {
    seed();
    const { status, json } = await call("GET", "/enrollment-approvals/pending-count", { as: "hr" });

    assert.equal(status, 200);
    assert.deepEqual(json.data, { pendingCount: 2 });
  });

  test("one application is read whole, and another company's is 404", async () => {
    seed();
    const { status, json } = await call("GET", `/enrollment-approvals/${FIRST}`, { as: "hr" });

    assert.equal(status, 200);
    assert.equal(json.data.application_no.startsWith("GCLI-"), true);
    assert.equal(json.data.employee.employee_id_number, "EMP-1");
    assert.deepEqual(json.data.loan_limits, LIMITS);

    assert.equal((await call("GET", `/enrollment-approvals/${FIRST}`, { as: "otherHr" })).status, 404);
    assert.equal((await call("GET", "/enrollment-approvals/12", { as: "hr" })).status, 404);
    assert.equal((await call("GET", "/enrollment-approvals/abc", { as: "hr" })).status, 404);
  });

  test("HR corrects an application with a reason", async () => {
    seed();
    const { status, json } = await call("PATCH", `/enrollment-approvals/${FIRST}`, {
      as: "hr",
      body: { changes: { contact_no: "09181234567", loan: { loan_amount: 900000 } }, reason: "Typo" },
    });

    assert.equal(status, 200);
    assert.equal(json.data.employee.contact_no, "09181234567");
    assert.equal(json.data.loan.loan_amount, 900000);
    assert.equal(json.data.history.at(-1).action, "edited");

    const refused = await call("PATCH", `/enrollment-approvals/${FIRST}`, { as: "hr", body: { changes: { contact_no: "09191234567" } } });
    assert.equal(refused.status, 400, "no reason");
    const outside = await call("PATCH", `/enrollment-approvals/${FIRST}`, { as: "hr", body: { changes: { loan: { loan_amount: 9000000 } }, reason: "r" } });
    assert.equal(outside.status, 422);
    assert.match(outside.json.message, /up to PHP 5,000,000/);
    assert.equal(outside.json.success, false);
  });

  test("HR approves with a day the cover starts, returns with a note, or rejects with one", async () => {
    seed();

    const approved = await call("POST", `/enrollment-approvals/${FIRST}/approve`, { as: "hr", body: { effectivity_date: "2026-11-02" } });
    assert.equal(approved.status, 200);
    assert.deepEqual(approved.json.data, { client_id: FIRST, status: "approved" });

    const returned = await call("POST", "/enrollment-approvals/900000000002/return", { as: "hr", body: { note: "Check the reference" } });
    assert.deepEqual(returned.json.data, { client_id: "900000000002", status: "returned" });

    assert.equal((await call("GET", "/enrollment-approvals?status=approved", { as: "hr" })).json.data.total, 1);
    assert.equal((await call("GET", "/enrollment-approvals?status=returned", { as: "hr" })).json.data.total, 1);
    assert.deepEqual((await call("GET", "/enrollment-approvals/pending-count", { as: "hr" })).json.data, { pendingCount: 0 });
  });

  test("a decision needs its day or its note, and is made once", async () => {
    seed();

    assert.equal((await call("POST", `/enrollment-approvals/${FIRST}/approve`, { as: "hr", body: {} })).status, 400);
    assert.equal((await call("POST", `/enrollment-approvals/${FIRST}/reject`, { as: "hr", body: {} })).status, 400);
    assert.equal((await call("POST", `/enrollment-approvals/${FIRST}/reject`, { as: "hr", body: { note: "Not covered" } })).status, 200);
    assert.equal((await call("POST", `/enrollment-approvals/${FIRST}/approve`, { as: "hr", body: { effectivity_date: "2026-11-02" } })).status, 409);
    assert.equal((await call("POST", `/enrollment-approvals/${FIRST}/reject`, { as: "otherHr", body: { note: "n" } })).status, 404);
  });
});

describe("View Details of an application on the Dashboard", () => {
  useDevStore();

  test("answers for an application, and leaves every other id to the usual route", async () => {
    savePlan("2", { plan: CREDIT_PLAN, loan_limits: LIMITS });
    apply("a", "EMP-1");

    const found = await call("GET", `/enrollments/${FIRST}`, { as: "hr" });
    assert.equal(found.status, 200);
    assert.equal(found.json.data.enrollment[0].client_id, FIRST);
    assert.equal(found.json.data.enrollment[0].status, "P");

    // an enrollment's id is not this router's: it falls through, and here nothing is behind it
    assert.equal((await call("GET", "/enrollments/41", { as: "hr" })).status, 404);

    assert.equal((await call("GET", `/enrollments/${FIRST}`, { as: "otherHr" })).status, 404);
    assert.equal((await call("GET", `/enrollments/${FIRST}`, { as: "employee" })).status, 403);
    assert.equal((await call("GET", `/enrollments/${FIRST}`)).status, 401);
  });
});
