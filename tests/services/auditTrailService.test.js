import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";
import { callTo, declarationOf, fakePool } from "../helpers/fakePool.js";
import { makeNext, makeReq, makeRes } from "../helpers/http.js";

const { auditLogOf, auditRowOf, listAuditLogs, parseAuditQuery, recordAuditEntry } = await import("../../src/services/auditTrailService.js");
const { default: AuditTrailModel } = await import("../../src/models/auditTrailModel.js");
const { createGetAuditTrail } = await import("../../src/controllers/auditTrailController.js");
const { changeRequestAuditEntry } = await import("../../src/utils/changeRequestAudit.js");
const { sqlErrorMap } = await import("../../src/utils/sqlErrorMap.js");

// The CRUD audit trail, DBA request 34: the row, the write that never fails
// its caller, the Administrator's list, and a change request decision's values.

const INSERT = "sec.usp_ins_audit_log";
const LIST = "sec.usp_sel_audit_logs";

describe("auditRowOf", () => {
  test("values go as JSON text, and none as NULL (stored as {})", () => {
    const row = auditRowOf({ userId: "3", objectName: "Company", recordId: "9", action: "U", ipAddress: "10.0.0.5", oldValues: { a: 1 }, newValues: { a: 2 } });

    assert.equal(row.oldValues, '{"a":1}');
    assert.equal(row.newValues, '{"a":2}');
    assert.equal(auditRowOf({ userId: "3", objectName: "Company", action: "I", ipAddress: "x" }).oldValues, null);
  });

  test("anything but a plain object is not stored as values", () => {
    for (const values of [["a"], "text", 5, null]) assert.equal(auditRowOf({ userId: "3", objectName: "C", action: "U", ipAddress: "x", newValues: values }).newValues, null, JSON.stringify(values));
  });

  test("the address is plain IPv4, never empty, at most 45; the module at most 100; no record is null", () => {
    assert.equal(auditRowOf({ userId: "3", objectName: "C", action: "I", ipAddress: "::ffff:10.0.0.5" }).ipAddress, "10.0.0.5");
    assert.equal(auditRowOf({ userId: "3", objectName: "C", action: "I", ipAddress: undefined }).ipAddress, "unknown");
    assert.equal(auditRowOf({ userId: "3", objectName: "x".repeat(150), action: "I", ipAddress: "a" }).objectName.length, 100);
    assert.equal(auditRowOf({ userId: "3", objectName: "C", action: "I", ipAddress: "a" }).recordId, null);
  });
});

describe("recordAuditEntry", () => {
  test("writes the row through the model, waiting for a pool still being opened", async () => {
    const rows = [];
    await recordAuditEntry(Promise.resolve("pool"), { userId: "3", objectName: "Company", action: "I", ipAddress: "a" }, {
      model: { insertAuditLog: async (pool, row) => rows.push({ pool, row }) },
      log: () => {},
    });

    assert.equal(rows[0].pool, "pool");
    assert.equal(rows[0].row.objectName, "Company");
  });

  test("a failed write never reaches the caller, and the log names the module, not the person", async () => {
    const logged = [];

    await assert.doesNotReject(() =>
      recordAuditEntry("pool", { userId: "3", objectName: "Company", action: "U", ipAddress: "a", newValues: { tin_id: "123-456-789" } }, {
        model: { insertAuditLog: async () => Promise.reject(new Error("procedure missing")) },
        log: (...args) => logged.push(args),
      }),
    );
    assert.equal(logged.length, 1);
    assert.match(logged[0][0], /U on Company/);
    assert.ok(!logged[0][0].includes("123-456-789"));
  });
});

describe("AuditTrailModel", () => {
  test("the insert binds every column, with no session and no OUTPUT parameter", async () => {
    const { pool, calls } = fakePool({ [INSERT]: [{ audit_log_id: "1" }] });
    await AuditTrailModel.insertAuditLog(pool, auditRowOf({ userId: "3", objectName: "Company", recordId: "9", action: "U", ipAddress: "10.0.0.5", newValues: { a: 1 } }));

    const call = callTo(calls, INSERT);
    assert.deepEqual(call.inputs, {
      us01_user_id: "3",
      us07_object_name: "Company",
      us07_record_id: "9",
      us07_action: "U",
      us07_ip_address: "10.0.0.5",
      us06_session_id: null,
      us07_old_values: null,
      us07_new_values: '{"a":1}',
    });
    assert.deepEqual(call.outputs, {});
    assert.equal(declarationOf(call.bindings.us07_new_values.type), "nvarchar");
    assert.ok(call.bindings.us07_new_values.type.length > 4000, "the values are NVARCHAR(MAX)");
  });

  test("the list sends the caller, the filters and the page", async () => {
    const { pool, calls } = fakePool({ [LIST]: [] });
    await AuditTrailModel.getAuditLogs(pool, 1, { username: "hr.", objectName: "Company", action: "U", fromDate: "2026-11-01", toDate: "2026-11-11", page: 2, pageSize: 50 });

    assert.deepEqual(callTo(calls, LIST).inputs, {
      us01_user_id: 1,
      username: "hr.",
      object_name: "Company",
      action: "U",
      from_date: "2026-11-01",
      to_date: "2026-11-11",
      page: 2,
      page_size: 50,
    });
  });
});

describe("parseAuditQuery", () => {
  test("nothing given is every row, first page of 25", () => {
    assert.deepEqual(parseAuditQuery({}), { username: null, objectName: null, action: null, fromDate: null, toDate: null, page: 1, pageSize: 25 });
  });

  test("the action is a word, in any case, sent as its code", () => {
    assert.equal(parseAuditQuery({ action: "update" }).action, "U");
    assert.equal(parseAuditQuery({ action: "CREATE" }).action, "I");
    assert.equal(parseAuditQuery({ action: "DELETE" }).action, "D");
    for (const action of ["U", "LOGIN", ["UPDATE"]]) assert.throws(() => parseAuditQuery({ action }), { statusCode: 400 }, JSON.stringify(action));
  });

  test("the username and module are trimmed and held to their columns; dates as for the security log", () => {
    assert.equal(parseAuditQuery({ username: " hr. ", module: " Company " }).objectName, "Company");
    assert.throws(() => parseAuditQuery({ username: "u".repeat(51) }), { statusCode: 400 });
    assert.throws(() => parseAuditQuery({ module: "m".repeat(101) }), { statusCode: 400 });
    assert.throws(() => parseAuditQuery({ from_date: "2026-02-30" }), { statusCode: 400 });
    assert.throws(() => parseAuditQuery({ from_date: "2026-11-12", to_date: "2026-11-11" }), { statusCode: 400 });
  });
});

describe("auditLogOf and the list", () => {
  const ROW = {
    audit_log_id: "5",
    executed_at: new Date("2026-11-11T02:00:00Z"),
    us01_user_id: "3",
    username: "hr.abcc",
    first_name: "Maria",
    last_name: "Reyes",
    object_name: "Company",
    record_id: "9",
    action: "U",
    old_values: '{"company_name":"Old"}',
    new_values: "{}",
    ip_address: "10.0.0.5",
    total_count: 1,
  };

  test("a row: the person, the module, the record, the action in words, and the values as objects", () => {
    assert.deepEqual(auditLogOf(ROW), {
      audit_log_id: "5",
      executed_at: ROW.executed_at,
      user: { user_id: "3", username: "hr.abcc", first_name: "Maria", last_name: "Reyes" },
      module: "Company",
      record_id: "9",
      action: "UPDATE",
      old_values: { company_name: "Old" },
      new_values: {},
      ip_address: "10.0.0.5",
    });
  });

  test("record 0, the procedure's 'no single record', is null; text that is not JSON is shown as it is", () => {
    const shown = auditLogOf({ ...ROW, record_id: "0", old_values: "not json" });

    assert.equal(shown.record_id, null);
    assert.deepEqual(shown.old_values, { value: "not json" });
  });

  test("the list answers the paging envelope", async () => {
    const page = await listAuditLogs("pool", 1, {}, { model: { getAuditLogs: async () => [ROW] } });

    assert.equal(page.total, 1);
    assert.equal(page.rows[0].action, "UPDATE");
    assert.equal(page.rows[0].total_count, undefined);
  });

  test("the controller answers { success, data }", async () => {
    const res = makeRes();
    await createGetAuditTrail({ poolOf: async () => "pool", list: async () => ({ rows: [], total: 0 }) })(makeReq({ user: { user_id: 1 } }), res, makeNext());

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { success: true, data: { rows: [], total: 0 } });
  });

  test("50236 from the procedure is a 403", () => {
    assert.equal(sqlErrorMap[50236].statusCode, 403);
  });
});

describe("changeRequestAuditEntry", () => {
  const DETAILS = {
    changedFields: [{ field_name: "Last Name", current_value: "Reyes", proposed_value: "Santos" }],
    addresses: [{ change_action: "U", address_line: "2 Mabini St.", zip_code: "1000", client_address_id: "4" }],
    beneficiaries: [{ change_action: "I", full_name: "Jose Santos", relationship: "Son", age: 5, coverage_percent: 100 }],
  };

  test("an approval: the status, every changed field on both sides, and the address and beneficiary changes", () => {
    assert.deepEqual(changeRequestAuditEntry(DETAILS, { approved: true, reviewRemarks: "OK" }), {
      object: "Profile change request (approved)",
      oldValues: { Status: "PENDING", "Last Name": "Reyes" },
      newValues: {
        Status: "APPROVED",
        "Review remarks": "OK",
        "Last Name": "Santos",
        "Address 1": "Updated: 2 Mabini St., 1000",
        "Beneficiary 1": "Added: Jose Santos, Son, age 5, 100%",
      },
    });
  });

  test("a rejection: the decision and its reason only", () => {
    assert.deepEqual(changeRequestAuditEntry(DETAILS, { approved: false, reviewRemarks: "Wrong spelling" }), {
      object: "Profile change request (rejected)",
      oldValues: { Status: "PENDING" },
      newValues: { Status: "REJECTED", "Review remarks": "Wrong spelling" },
    });
  });
});
