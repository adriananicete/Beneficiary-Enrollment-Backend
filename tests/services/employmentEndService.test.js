import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";
import { fakePool, inputsFor } from "../helpers/fakePool.js";

const { default: EmploymentEndService } = await import("../../src/services/employmentEndService.js");

// Ending an employment, DBA request 39. The scoping, the refusals and the
// writes are the procedure's, read back 2026-11-23 and proven only by the
// manual run. What is tested here is what this side does with its answer.

const END = "bes.usp_upd_employment_end";
const UNDO = "bes.usp_del_employment_end";

const ENDED_ROW = {
  client_id: "75",
  enrollment_id: "54",
  employment_end_reason: "RESIGNED",
  employment_end_date: "2026-11-20",
  cancelled_requests: 1,
  us01_user_id: "88",
};

const recorder = () => {
  const ended = { users: [], clients: [] };
  return {
    ended,
    deps: {
      endUserSessions: (userId) => ended.users.push(userId),
      endClientSessions: (clientId) => ended.clients.push(clientId),
    },
  };
};

const END_ARGS = { clientId: "75", reason: "RESIGNED", endDate: "2026-11-20", userId: 3 };

describe("employmentEndService.endEmployment", () => {
  test("sends the employee, the reason, the date and the caller", async () => {
    const { pool, calls } = fakePool({ [END]: [ENDED_ROW] });
    const { deps } = recorder();

    await EmploymentEndService.endEmployment(pool, END_ARGS, deps);

    assert.deepEqual(inputsFor(calls, END), {
      client_id: "75",
      end_reason: "RESIGNED",
      end_date: "2026-11-20",
      us01_user_id: 3,
    });
  });

  test("answers what the procedure recorded", async () => {
    const { pool } = fakePool({ [END]: [ENDED_ROW] });
    const { deps } = recorder();

    assert.deepEqual(await EmploymentEndService.endEmployment(pool, END_ARGS, deps), {
      client_id: "75",
      enrollment_id: "54",
      employment_end_reason: "RESIGNED",
      employment_end_date: "2026-11-20",
      cancelled_requests: 1,
    });
  });

  // The procedure closed the login and raised the token version. The sockets
  // opened before are closed here: the user's (an HR person who enrolled
  // themselves has only that room) and the client's.
  test("closes the open sockets of the account and of the employee", async () => {
    const { pool } = fakePool({ [END]: [ENDED_ROW] });
    const { ended, deps } = recorder();

    await EmploymentEndService.endEmployment(pool, END_ARGS, deps);

    assert.deepEqual(ended, { users: ["88"], clients: ["75"] });
  });

  test("an account the procedure did not name still has the employee's sockets closed", async () => {
    const { pool } = fakePool({ [END]: [{ ...ENDED_ROW, us01_user_id: null }] });
    const { ended, deps } = recorder();

    await EmploymentEndService.endEmployment(pool, END_ARGS, deps);

    assert.deepEqual(ended, { users: [], clients: ["75"] });
  });

  // A refusal (50241, 50245, ...) is the procedure's THROW, rolled back. No
  // session is ended for an employment that did not end.
  test("a refusal reaches the caller and ends no session", async () => {
    const refusal = Object.assign(new Error("This employee has an open claim."), { number: 50245 });
    const { pool } = fakePool({
      [END]: () => {
        throw refusal;
      },
    });
    const { ended, deps } = recorder();

    await assert.rejects(() => EmploymentEndService.endEmployment(pool, END_ARGS, deps), refusal);
    assert.deepEqual(ended, { users: [], clients: [] });
  });

  test("no cancelled count reads as zero, never undefined", async () => {
    const { pool } = fakePool({ [END]: [{ ...ENDED_ROW, cancelled_requests: undefined }] });
    const { deps } = recorder();

    assert.equal((await EmploymentEndService.endEmployment(pool, END_ARGS, deps)).cancelled_requests, 0);
  });
});

describe("employmentEndService.undoEmploymentEnd", () => {
  test("sends the employee and the caller, and answers the reopened enrollment", async () => {
    const { pool, calls } = fakePool({ [UNDO]: [{ client_id: "75", enrollment_id: "54" }] });

    assert.deepEqual(await EmploymentEndService.undoEmploymentEnd(pool, { clientId: "75", userId: 1 }), {
      client_id: "75",
      enrollment_id: "54",
    });
    assert.deepEqual(inputsFor(calls, UNDO), { client_id: "75", us01_user_id: 1 });
  });
});
