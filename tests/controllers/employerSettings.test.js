import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";
import { makeNext, makeReq, makeRes } from "../helpers/http.js";

const { settingsOf, updateEmployerSettings, NO_SETTING, MESSAGING_ADMINISTRATOR_ONLY } = await import(
  "../../src/controllers/employerSettingsController.js"
);
const { publicEmployer } = await import("../../src/controllers/enrollmentController.js");

// The per-company settings, DBA request 19. The scoping is in the procedures
// and is proven against the real database (md/DBA-REQUEST-19.md, steps 3–5).
// What is tested here is what this side decides on its own.

// Refused before the database is touched. getPool is never reached, so these
// run without one.
const refusalFor = async (body, role_name = "Administrator") => {
  const next = makeNext();

  await updateEmployerSettings(
    makeReq({ params: { employer_id: "1" }, body, user: { user_id: 3, role_name } }),
    makeRes(),
    next,
  );

  return next.refusal();
};

describe("updateEmployerSettings — the body", () => {
  for (const field of ["send_coc_email", "messages_enabled"])
    test(`${field}: anything but a real boolean is 400`, async () => {
      for (const value of ["false", "true", 0, 1, null, {}, []]) {
        const refusal = await refusalFor({ [field]: value });

        assert.equal(refusal?.statusCode, 400, JSON.stringify(value));
        assert.equal(refusal.message, `${field} must be true or false`);
      }
    });

  // A setting left out is kept, so a body with neither changes nothing and
  // says so, rather than writing the two settings back as they were.
  test("a body with neither setting is 400", async () => {
    for (const body of [{}, { unrelated: true }]) {
      const refusal = await refusalFor(body);

      assert.equal(refusal?.statusCode, 400, JSON.stringify(body));
      assert.equal(refusal.message, NO_SETTING);
    }
  });
});

// Adrian, 2026-11-11: only the Administrator turns a company's messaging on or
// off. HR keeps the COC email setting.
describe("updateEmployerSettings — who changes messaging", () => {
  test("HR sending messages_enabled is 403, even with send_coc_email beside it", async () => {
    for (const body of [{ messages_enabled: false }, { messages_enabled: true, send_coc_email: true }]) {
      const refusal = await refusalFor(body, "HR");

      assert.equal(refusal?.statusCode, 403, JSON.stringify(body));
      assert.equal(refusal.message, MESSAGING_ADMINISTRATOR_ONLY);
    }
  });

  // A bad value is still 400, whoever sends it: the shape is checked first.
  test("HR sending a bad messages_enabled is 400, not 403", async () => {
    assert.equal((await refusalFor({ messages_enabled: "false" }, "HR"))?.statusCode, 400);
  });
});

describe("the fields that leave", () => {
  const row = {
    employer_id: "1",
    company_code: "COF",
    company_name: "Coforge BPS Philippines, Inc.",
    send_coc_email: true,
    messages_enabled: true,
    modified_by: "3",
    modified_date: new Date("2026-10-06T10:00:00Z"),
    // A column a procedure might gain later.
    policy_no: "G-TLI-26-136",
    office_no: "secret",
  };

  test("settings answer with the seven named fields, and nothing a procedure adds later", () => {
    assert.deepEqual(Object.keys(settingsOf(row)).sort(), [
      "company_code",
      "company_name",
      "employer_id",
      "messages_enabled",
      "modified_by",
      "modified_date",
      "send_coc_email",
    ]);
  });

  // As the gate reads it. HCL's was NULL on 2026-11-11, and the access
  // procedure counts that as off.
  test("messages_enabled is a boolean, with NULL shown as off", () => {
    assert.equal(settingsOf(row).messages_enabled, true);
    assert.equal(settingsOf({ ...row, messages_enabled: false }).messages_enabled, false);
    assert.equal(settingsOf({ ...row, messages_enabled: null }).messages_enabled, false);
  });

  // GET /enrollment/employers needs no account. send_coc_email is on the
  // table since 2026-10-06; it must never reach this list.
  test("the public employer list carries the four fields it always has, and no setting", () => {
    const shown = publicEmployer({ ...row, status: "A" });

    assert.deepEqual(Object.keys(shown).sort(), ["company_code", "company_name", "employer_id", "status"]);
    assert.equal("send_coc_email" in shown, false);
  });
});
