import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";
import { fakePool, inputsFor } from "../helpers/fakePool.js";

const { default: EmployerSettingsService } = await import(
  "../../src/services/employerSettingsService.js"
);

// Saving the Certificate of Coverage email setting. bes.usp_upd_employer_settings
// takes both settings, mandatory, and writes both as given (UAT, 2026-11-11), so
// the one not being changed is read first and sent back as it stands. The
// scoping and the refusals are the procedures' own; what is tested here is
// that messages_enabled reaches the update untouched.

const LIST = "bes.usp_sel_employer_settings";
const UPDATE = "bes.usp_upd_employer_settings";

// As usp_sel_employer_settings answers the Administrator: every active company.
const COMPANIES = [
  { employer_id: "1", company_code: "Coforge", send_coc_email: true, messages_enabled: true },
  { employer_id: "2", company_code: "HCL", send_coc_email: true, messages_enabled: null },
  { employer_id: "10003", company_code: "ABACUS", send_coc_email: true, messages_enabled: false },
];

const save = (employerId, { companies = COMPANIES, update = [{ employer_id: employerId }] } = {}) => {
  const { pool, calls } = fakePool({ [LIST]: companies, [UPDATE]: update });

  return {
    calls,
    result: EmployerSettingsService.updateSettings(pool, {
      employerId,
      sendCocEmail: false,
      userId: 7,
    }),
  };
};

describe("employerSettingsService — messages_enabled goes back as it stands", () => {
  for (const [employerId, expected] of [
    ["1", true],
    ["10003", false],
  ]) {
    test(`company ${employerId}: sends ${expected}, and send_coc_email as asked`, async () => {
      const { calls, result } = save(employerId);
      await result;

      const sent = inputsFor(calls, UPDATE);

      assert.equal(sent.messages_enabled, expected);
      assert.equal(sent.send_coc_email, false);
      assert.equal(sent.employer_id, employerId);
      assert.equal(sent.us01_user_id, 7);
    });
  }

  // HCL's was NULL. Inventing true or false here would change a setting
  // nobody asked to change.
  test("a NULL setting goes back as NULL", async () => {
    const { calls, result } = save("2");
    await result;

    assert.equal(inputsFor(calls, UPDATE).messages_enabled, null);
  });

  // The path id is a string and the procedure's id is a BigInt string; a
  // number must match too.
  test("finds the company whether its id arrives as text or a number", async () => {
    const { calls, result } = save(1);
    await result;

    assert.equal(inputsFor(calls, UPDATE).messages_enabled, true);
  });

  test("reads the caller's own list, before the update", async () => {
    const { calls, result } = save("1");
    await result;

    assert.equal(inputsFor(calls, LIST).us01_user_id, 7);
    assert.deepEqual(
      calls.map((call) => call.procedure),
      [LIST, UPDATE],
    );
  });

  test("answers the procedure's updated row", async () => {
    const row = { employer_id: "1", send_coc_email: false, messages_enabled: true };
    const { result } = save("1", { update: [row] });

    assert.deepEqual(await result, row);
  });
});

// The Administrator changes messaging, 2026-11-11. The COC setting is then
// the one left out, and goes back as it stands.
describe("employerSettingsService — changing messaging", () => {
  const saveMessaging = (employerId, messagesEnabled, sendCocEmail) => {
    const { pool, calls } = fakePool({ [LIST]: COMPANIES, [UPDATE]: [{ employer_id: employerId }] });

    return {
      calls,
      result: EmployerSettingsService.updateSettings(pool, { employerId, messagesEnabled, sendCocEmail, userId: 1 }),
    };
  };

  test("sends messages_enabled as asked, and send_coc_email as it stands", async () => {
    const { calls, result } = saveMessaging("1", false);
    await result;

    const sent = inputsFor(calls, UPDATE);

    assert.equal(sent.messages_enabled, false);
    assert.equal(sent.send_coc_email, true);
  });

  // false is a value, not "left out". `??` keeps it; `||` would not.
  test("false is sent as false, not replaced by the stored value", async () => {
    const { calls, result } = saveMessaging("1", false);
    await result;

    assert.equal(inputsFor(calls, UPDATE).messages_enabled, false);
  });

  test("turning HCL's NULL on sends true", async () => {
    const { calls, result } = saveMessaging("2", true);
    await result;

    assert.equal(inputsFor(calls, UPDATE).messages_enabled, true);
  });

  // Nothing is left out, so nothing is read.
  test("with both settings sent, the list is not read", async () => {
    const { calls, result } = saveMessaging("1", true, false);
    await result;

    assert.deepEqual(
      calls.map((call) => call.procedure),
      [UPDATE],
    );
    assert.equal(inputsFor(calls, UPDATE).send_coc_email, false);
    assert.equal(inputsFor(calls, UPDATE).messages_enabled, true);
  });
});

describe("employerSettingsService — a company the caller cannot see", () => {
  // Missing from the caller's list means the update refuses it before writing:
  // 50140 inactive or unknown, 50141 another company's. So the refusal is the
  // procedure's, unchanged, and the NULL sent with it is never stored.
  test("still asks the procedure, with NULL, and passes its refusal on", async () => {
    const refusal = Object.assign(new Error("You can only change the settings of your own company."), {
      number: 50141,
    });
    const { calls, result } = save("2", {
      companies: [COMPANIES[0]],
      update: () => {
        throw refusal;
      },
    });

    await assert.rejects(() => result, (error) => error === refusal);
    assert.equal(inputsFor(calls, UPDATE).messages_enabled, null);
  });
});
