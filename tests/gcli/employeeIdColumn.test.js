import { describe, test } from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";
import ExcelJS from "exceljs";
import "../helpers/env.js";
import { fakePool, inputsFor } from "../helpers/fakePool.js";
import { useDevStore } from "../helpers/gcliStore.js";

const { partitionInvitations, MAX_EMPLOYEE_ID_LENGTH } = await import("../../src/utils/partitionInvitations.js");
const { buildInvitationTemplate, INVITATIONS_SHEET } = await import("../../src/utils/invitationTemplate.js");
const { default: InvitationService } = await import("../../src/services/invitationService.js");
const { default: InvitationJobStore } = await import("../../src/services/invitationJobStore.js");
const { invitedEmployeeId, setInvitedEmployeeId } = await import("../../src/gcli/invitedEmployeeId.js");
const { readStore } = await import("../../src/gcli/devStore.js");

// The Employee ID column of HR's invitation file: in the template, in the rows, and in what is kept with
// the invitation.

const company = { employer_id: "5", company_code: "ABCC", company_name: "Abacus" };
const classes = [{ classification_id: "51", classification_code: "CLASS 1", classification_desc: "Officers" }];
const codes = { company, classes, affiliates: [] };

const row = (email, id, extra = {}) => ({ email_address: email, classification_code: "CLASS 1", ...(id === undefined ? {} : { employee_id_number: id }), ...extra });
const partition = (rows, extra = {}) => partitionInvitations(rows, { ...codes, employeeIds: true, ...extra });

describe("the template", () => {
  const headers = async (options) => {
    const buffer = await buildInvitationTemplate({ ...codes, ...options }).xlsx.writeBuffer();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet(INVITATIONS_SHEET);
    return { sheet, headers: sheet.getRow(1).values.slice(1) };
  };

  test("has an Employee ID column, after the others, where the server keeps it", async () => {
    assert.deepEqual((await headers({ employeeIds: true })).headers, ["Email", "Classification", "Employee ID"]);
  });

  test("and with affiliates it is still last", async () => {
    const affiliates = [{ affiliate_id: "7", affiliate_code: "ALAKOR", affiliate_name: "Alakor" }];
    assert.deepEqual((await headers({ employeeIds: true, affiliates })).headers, ["Email", "Classification", "Affiliate", "Employee ID"]);
  });

  test("has none where the server cannot keep it, so HR is never asked for what is dropped", async () => {
    assert.deepEqual((await headers({})).headers, ["Email", "Classification"]);
    assert.deepEqual((await headers({ employeeIds: false })).headers, ["Email", "Classification"]);
  });

  test("keeps the dropdown on the Classification column, and the ID column is text", async () => {
    const { sheet } = await headers({ employeeIds: true });

    assert.equal(sheet.getCell("B2").dataValidation?.type, "list");
    assert.equal(sheet.getCell("C2").dataValidation, undefined, "no dropdown on the ID");
    assert.equal(sheet.getColumn(3).numFmt, "@", "text, so 00123 keeps its zeros");
  });
});

describe("the rows of the file", () => {
  test("a row's employee ID is kept with it", () => {
    const { valid, rejected } = partition([row("ana@abcc.example", "EMP-0042")]);

    assert.deepEqual(rejected, []);
    assert.deepEqual(valid, [{ email: "ana@abcc.example", classificationId: "51", affiliateId: null, employeeId: "EMP-0042" }]);
  });

  test("is optional: a row without one is as it was, with no employeeId at all", () => {
    for (const id of [undefined, "", "   ", null]) {
      const { valid } = partition([row("ana@abcc.example", id)]);
      assert.deepEqual(valid, [{ email: "ana@abcc.example", classificationId: "51", affiliateId: null }], String(id));
    }
  });

  test("is trimmed, and a number from Excel is taken as its text", () => {
    assert.equal(partition([row("ana@abcc.example", "  EMP-1  ")]).valid[0].employeeId, "EMP-1");
    assert.equal(partition([row("ana@abcc.example", 12345)]).valid[0].employeeId, "12345");
  });

  test("may be as long as the form's field and no longer", () => {
    assert.equal(partition([row("a@abcc.example", "x".repeat(MAX_EMPLOYEE_ID_LENGTH))]).valid.length, 1);

    const tooLong = partition([row("a@abcc.example", "x".repeat(MAX_EMPLOYEE_ID_LENGTH + 1))]);
    assert.deepEqual(tooLong.valid, []);
    assert.deepEqual(tooLong.rejected, [
      { email: "a@abcc.example", status: "invalid", reason: `Employee ID is longer than ${MAX_EMPLOYEE_ID_LENGTH} characters` },
    ]);
  });

  test("two rows of one file cannot share an ID, whatever its case; the second is named", () => {
    const { valid, rejected } = partition([row("ana@abcc.example", "EMP-1"), row("jun@abcc.example", "emp-1"), row("zoe@abcc.example", "EMP-2")]);

    assert.deepEqual(valid.map((v) => v.email), ["ana@abcc.example", "zoe@abcc.example"]);
    assert.deepEqual(rejected, [{ email: "jun@abcc.example", status: "duplicate", reason: "Employee ID repeated in this upload" }]);
  });

  test("a row refused for another reason does not use up its ID", () => {
    const { valid, rejected } = partition([row("ana@abcc.example", "EMP-1", { classification_code: "NOPE" }), row("jun@abcc.example", "EMP-1")]);

    assert.equal(rejected.length, 1);
    assert.deepEqual(valid.map((v) => [v.email, v.employeeId]), [["jun@abcc.example", "EMP-1"]]);
  });

  test("only text or a number is an ID: an object, a list or true is refused, not turned into text", () => {
    for (const bad of [{}, [1, 2], true, false]) {
      const { valid, rejected } = partition([row("ana@abcc.example", bad)]);

      assert.deepEqual(valid, [], JSON.stringify(bad));
      assert.deepEqual(rejected, [{ email: "ana@abcc.example", status: "invalid", reason: "Employee ID must be text" }], JSON.stringify(bad));
    }
  });

  test("a long number Excel shortened (1.23457E+11) is refused with what to do, never taken as the ID", () => {
    for (const shortened of ["1.23457E+11", "1.23457E+12", "1E+12", "9.9E-05", 1.234e21]) {
      const { valid, rejected } = partition([row("ana@abcc.example", shortened)]);

      assert.deepEqual(valid, [], String(shortened));
      assert.match(rejected[0].reason, /Excel shortened. Format the column as Text/, String(shortened));
    }
  });

  test("an ID that merely has an E in it is still an ID", () => {
    for (const fine of ["E1234", "EMP-1E5", "1E5", "12E34", "A1.5E+07", "2026E001"]) {
      assert.equal(partition([row("ana@abcc.example", fine)]).valid.length, 1, fine);
    }
  });

  test("is ignored where the server cannot keep it, even a long one", () => {
    const { valid, rejected } = partitionInvitations([row("ana@abcc.example", "x".repeat(99))], { ...codes });

    assert.deepEqual(rejected, []);
    assert.deepEqual(valid, [{ email: "ana@abcc.example", classificationId: "51", affiliateId: null }]);
  });
});

describe("a bulk send with employee IDs", () => {
  const store = useDevStore();

  const EMPLOYERS = "sec.us08_usp_sel_employers_by_user";
  const INSERT = "bes.usp_ins_enrollment_invitation";
  const answers = {
    [EMPLOYERS]: [company],
    usp_sel_classifications_by_employer: classes,
    usp_sel_employer_affiliates_by_user: [],
    // refused, so the job stops before it would send an email
    [INSERT]: () => {
      throw Object.assign(new Error("SQL 50181"), { number: 50181 });
    },
  };

  const settled = async (jobId) => {
    for (let i = 0; i < 200; i++) {
      const job = InvitationJobStore.getJob(jobId);
      if (job.status !== "processing") return job;
      await new Promise((resolve) => setImmediate(resolve));
    }
    throw new Error("the job never finished");
  };

  // The invitation is made and its email goes out, both answered here so nothing reaches Microsoft.
  const sendForReal = async (rows) => {
    const sent = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (String(url).includes("login.microsoftonline.com")) return { ok: true, json: async () => ({ access_token: "token", expires_in: 3600 }) };
      sent.push(JSON.parse(init.body).message.toRecipients[0].emailAddress.address);
      return { ok: true };
    };

    try {
      const made = fakePool({
        ...answers,
        [INSERT]: () => ({ recordset: [{ success: 1 }], output: { invitation_id: "77" } }),
        usp_upd_enrollment_invitation_send_status: [],
      });
      const answer = await InvitationService.sendInvitations(made.pool, 41, rows);
      return { answer, job: await settled(answer.jobId), calls: made.calls, sent };
    } finally {
      globalThis.fetch = realFetch;
    }
  };

  const tokenOf = (calls, email) => calls.find((c) => c.procedure === INSERT && c.inputs.email_address === email).inputs.token;

  const send = async (rows, queries = []) => {
    const { pool, calls } = fakePool(answers, queries);
    const answer = await InvitationService.sendInvitations(pool, 41, rows);
    return { answer, job: await settled(answer.jobId), calls };
  };

  test("the template the server gives carries the column", async () => {
    const { pool } = fakePool(answers);
    const { workbook } = await InvitationService.getTemplate(pool, 41);

    assert.deepEqual(workbook.getWorksheet(INVITATIONS_SHEET).getRow(1).values.slice(1), ["Email", "Classification", "Employee ID"]);
  });

  test("with the dev store off the template has no column, and an ID in the upload is ignored, even a long one", async () => {
    process.env.GCLI_DEV_STORE = "false";
    const { pool } = fakePool(answers);
    const { workbook } = await InvitationService.getTemplate(pool, 41);

    assert.deepEqual(workbook.getWorksheet(INVITATIONS_SHEET).getRow(1).values.slice(1), ["Email", "Classification"]);

    const { answer, calls } = await send([row("ana@abcc.example", "x".repeat(99))]);

    assert.deepEqual(answer.rejected, [], "not refused for an ID it does not read");
    assert.equal(answer.total, 1);
    assert.ok(calls.some((call) => call.procedure === INSERT));
    assert.ok(!calls.some((call) => /sec\.us01_users/.test(call.query ?? "")), "and not checked against the logins");
  });

  test("a row's ID reaches the invitation row it is kept for", async () => {
    const { answer, calls } = await send([row("ana@abcc.example", "EMP-0042")]);

    assert.deepEqual(answer.rejected, []);
    assert.equal(answer.total, 1);
    assert.equal(inputsFor(calls, INSERT).email_address, "ana@abcc.example");
  });

  test("an ID that is a login already is refused before the invitation is made", async () => {
    const { job, calls } = await send([row("ana@abcc.example", "EMP-0042")], [[/sec\.us01_users/, [{ one: 1 }]]]);

    assert.deepEqual(job.results, [{ email: "ana@abcc.example", status: "invalid", reason: "Employee ID is already a login, or given to another invitation" }]);
    assert.ok(!calls.some((call) => call.procedure === INSERT), "no invitation, so no email");
  });

  test("an ID another person was given is refused, in this company or another, and the same person's is not", async () => {
    setInvitedEmployeeId({ token: "ab".repeat(32), employeeId: "EMP-0042", employerId: "5", email: "jun@abcc.example" });
    setInvitedEmployeeId({ token: "cd".repeat(32), employeeId: "EMP-1001", employerId: "9", email: "ben@other.example" });

    const other = await send([row("ana@abcc.example", "emp-0042")]);
    assert.equal(other.job.results[0].reason, "Employee ID is already a login, or given to another invitation");
    assert.ok(!other.calls.some((call) => call.procedure === INSERT));

    // another company's invitation: a login name is shared by all, so Ben and Ana could not both enroll
    const elsewhere = await send([row("ana@abcc.example", "EMP-1001")]);
    assert.equal(elsewhere.job.results[0].status, "invalid");
    assert.ok(!elsewhere.calls.some((call) => call.procedure === INSERT));

    const same = await send([row("jun@abcc.example", "EMP-0042")]);
    assert.ok(same.calls.some((call) => call.procedure === INSERT), "the same person is invited again");
  });

  test("once the invitation is made, its ID is kept under its token, and the email goes out", async () => {
    const { job, calls, sent } = await sendForReal([row("ana@abcc.example", "EMP-0042"), row("jun@abcc.example")]);

    assert.deepEqual(job.results.map((r) => [r.email, r.status]).sort(), [["ana@abcc.example", "sent"], ["jun@abcc.example", "sent"]]);
    assert.deepEqual(sent.sort(), ["ana@abcc.example", "jun@abcc.example"]);
    assert.equal(invitedEmployeeId(tokenOf(calls, "ana@abcc.example")), "EMP-0042");
    assert.equal(Object.keys(readStore().invitedEmployeeIds).length, 1, "none for the row that gave no ID");
  });

  test("a person invited again lets go of the old invitation's ID, so someone else can have it", async () => {
    const first = await sendForReal([row("ana@abcc.example", "E-7")]);
    const old = tokenOf(first.calls, "ana@abcc.example");
    assert.equal(invitedEmployeeId(old), "E-7");

    // HR put E-7 on the wrong row: Ana is invited again with E-9
    const again = await sendForReal([row("ana@abcc.example", "E-9")]);
    assert.equal(invitedEmployeeId(old), null, "the old invitation's ID is let go");
    assert.equal(invitedEmployeeId(tokenOf(again.calls, "ana@abcc.example")), "E-9");

    const jun = await sendForReal([row("jun@abcc.example", "E-7")]);
    assert.deepEqual(jun.job.results.map((r) => r.status), ["sent"], "E-7 is free for Jun");
  });

  test("revoking an invitation frees its ID", async () => {
    const first = await sendForReal([row("ana@abcc.example", "E-7")]);
    const token = tokenOf(first.calls, "ana@abcc.example");

    const { pool, calls } = fakePool({
      usp_sel_enrollment_invitation_by_id: [{ invitation_id: "77", token, email_address: "ana@abcc.example", is_enrolled: 0 }],
      usp_del_enrollment_invitation: [],
    });
    await InvitationService.revokeInvitation(pool, 41, 77);

    assert.ok(calls.some((call) => call.procedure === "bes.usp_del_enrollment_invitation"));
    assert.equal(invitedEmployeeId(token), null);
    assert.equal(
      (await sendForReal([row("jun@abcc.example", "E-7")])).job.results[0].status,
      "sent",
      "E-7 can be given again",
    );
  });

  test("an invitation that is refused, or cannot keep its ID, is not made: no invitation without its ID", async () => {
    // the file cannot be written: its temporary file is in the way
    fs.mkdirSync(`${store.file}.tmp`);

    const { job, calls, sent } = await sendForReal([row("ana@abcc.example", "EMP-0042")]);

    assert.deepEqual(job.results, [{ email: "ana@abcc.example", status: "failed" }]);
    assert.ok(!calls.some((call) => call.procedure === INSERT), "no invitation row was made");
    assert.deepEqual(sent, [], "and no email went out");
  });

  test("an invitation the database refused keeps no ID", async () => {
    await send([row("ana@abcc.example", "EMP-0042")]);

    assert.deepEqual(readStore().invitedEmployeeIds, {});
    assert.equal(invitedEmployeeId("ab".repeat(32)), null);
  });

  test("a row with no ID is invited as before, and the check of logins is not made", async () => {
    const { calls } = await send([row("ana@abcc.example")]);

    assert.ok(calls.some((call) => call.procedure === INSERT));
    assert.ok(!calls.some((call) => /sec\.us01_users/.test(call.query ?? "")));
  });
});
