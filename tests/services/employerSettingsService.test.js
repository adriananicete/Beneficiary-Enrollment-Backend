import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";
import { fakePool, inputsFor } from "../helpers/fakePool.js";

const { default: EmployerSettingsService } = await import(
  "../../src/services/employerSettingsService.js"
);

// Saving a company's settings. Since DBA request 27 Part 2 (read back
// 2026-11-11), bes.usp_upd_employer_settings keeps a setting sent as NULL, in
// the same UPDATE. So the save is one call: what changed as given, the rest as
// NULL. No read first, and so no race between two saves.

const LIST = "bes.usp_sel_employer_settings";
const UPDATE = "bes.usp_upd_employer_settings";

const save = (fields) => {
  // The list is scripted so that a read, if one came back, would be seen in
  // the calls rather than fail on a missing answer.
  const { pool, calls } = fakePool({
    [LIST]: [{ employer_id: "1", send_coc_email: true, messages_enabled: true }],
    [UPDATE]: [{ employer_id: "1" }],
  });

  return {
    calls,
    result: EmployerSettingsService.updateSettings(pool, { employerId: "1", userId: 7, ...fields }),
  };
};

describe("employerSettingsService — one call, NULL for what was left out", () => {
  test("HR saving the COC setting: send_coc_email as asked, messages_enabled NULL", async () => {
    const { calls, result } = save({ sendCocEmail: false });
    await result;

    const sent = inputsFor(calls, UPDATE);

    assert.equal(sent.send_coc_email, false);
    assert.equal(sent.messages_enabled, null);
    assert.equal(sent.employer_id, "1");
    assert.equal(sent.us01_user_id, 7);
  });

  test("the Administrator saving messaging: messages_enabled as asked, send_coc_email NULL", async () => {
    const { calls, result } = save({ messagesEnabled: false });
    await result;

    const sent = inputsFor(calls, UPDATE);

    assert.equal(sent.messages_enabled, false);
    assert.equal(sent.send_coc_email, null);
  });

  test("both sent, both as given", async () => {
    const { calls, result } = save({ sendCocEmail: true, messagesEnabled: false });
    await result;

    const sent = inputsFor(calls, UPDATE);

    assert.equal(sent.send_coc_email, true);
    assert.equal(sent.messages_enabled, false);
  });

  // The point of request 27 Part 2: nothing is read, so two saves landing
  // together cannot undo each other.
  test("nothing is read first: the update is the only call", async () => {
    for (const fields of [{ sendCocEmail: false }, { messagesEnabled: true }, { sendCocEmail: true, messagesEnabled: true }]) {
      const { calls, result } = save(fields);
      await result;

      assert.deepEqual(
        calls.map((call) => call.procedure),
        [UPDATE],
        JSON.stringify(fields),
      );
    }
  });

  test("answers the procedure's updated row", async () => {
    const { result } = save({ sendCocEmail: true });

    assert.deepEqual(await result, { employer_id: "1" });
  });

  // A refusal is the procedure's, passed on: 50140, 50141 or 50223.
  test("passes a refusal from the procedure on, unchanged", async () => {
    const refusal = Object.assign(new Error("Only an Administrator can change the company messaging setting."), { number: 50223 });
    const { pool } = fakePool({
      [UPDATE]: () => {
        throw refusal;
      },
    });

    await assert.rejects(
      () => EmployerSettingsService.updateSettings(pool, { employerId: "1", messagesEnabled: true, userId: 4 }),
      (error) => error === refusal,
    );
  });
});
