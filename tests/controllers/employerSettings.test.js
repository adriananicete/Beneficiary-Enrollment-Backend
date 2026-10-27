import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";
import { makeNext, makeReq, makeRes } from "../helpers/http.js";

const { settingsOf, updateEmployerSettings } = await import(
  "../../src/controllers/employerSettingsController.js"
);
const { publicEmployer } = await import("../../src/controllers/enrollmentController.js");

// The per-company settings, DBA request 19. The scoping is in the procedures
// and is proven against the real database (md/DBA-REQUEST-19.md, steps 3–5).
// What is tested here is what this side decides on its own.

describe("updateEmployerSettings — the body", () => {
  // Refused before the database is touched. getPool is never reached, so this
  // runs without one.
  test("anything but a real boolean is 400", async () => {
    for (const value of ["false", "true", 0, 1, null, undefined, {}, []]) {
      const next = makeNext();

      await updateEmployerSettings(
        makeReq({ params: { employer_id: "1" }, body: { send_coc_email: value }, user: { user_id: 3 } }),
        makeRes(),
        next,
      );

      const refusal = next.refusal();
      assert.equal(refusal?.statusCode, 400, JSON.stringify(value));
      assert.equal(refusal.message, "send_coc_email must be true or false");
    }
  });
});

describe("the fields that leave", () => {
  const row = {
    employer_id: "1",
    company_code: "COF",
    company_name: "Coforge BPS Philippines, Inc.",
    send_coc_email: true,
    modified_by: "3",
    modified_date: new Date("2026-10-06T10:00:00Z"),
    // A column a procedure might gain later.
    policy_no: "G-TLI-26-136",
    office_no: "secret",
  };

  test("settings answer with the six named fields, and nothing a procedure adds later", () => {
    assert.deepEqual(Object.keys(settingsOf(row)).sort(), [
      "company_code",
      "company_name",
      "employer_id",
      "modified_by",
      "modified_date",
      "send_coc_email",
    ]);
  });

  // GET /enrollment/employers needs no account. send_coc_email is on the
  // table since 2026-10-06; it must never reach this list.
  test("the public employer list carries the four fields it always has, and no setting", () => {
    const shown = publicEmployer({ ...row, status: "A" });

    assert.deepEqual(Object.keys(shown).sort(), ["company_code", "company_name", "employer_id", "status"]);
    assert.equal("send_coc_email" in shown, false);
  });
});
