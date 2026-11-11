import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";
import { fakePool, inputsFor, queryMatching } from "../helpers/fakePool.js";

const { default: HrAccountService, hrUsernameFor } = await import("../../src/services/hrAccountService.js");
const { default: config } = await import("../../src/config/env.js");

// A company's one HR account, branch 4, on DBA request 24. The transaction
// here is a fake, injected: it proves the order of the writes and the email,
// which is this code's to get right. It cannot prove SQL Server accepts the
// calls (CLAUDE.md §11). The manual run does that.

const COMPANY = "bes.usp_sel_employer_admin_by_id";
const HR_BY_COMPANY = "sec.us08_usp_sel_hr_by_employer";
const CREATE_USER = "sec.us01_usp_ins_users";
const ASSIGN_ROLE = "sec.us04_usp_assign_role";
const MAP_HR = "sec.us08_usp_ins_user_employer";
const RESET = /UPDATE sec\.us01_users/;

const ADMIN_ID = 1;

const company = (overrides = {}) => ({
  employer_id: "5",
  company_code: "ABCC",
  company_name: "Abacus Book and Card Corporation",
  hr_user_id: null,
  ...overrides,
});

const person = {
  first_name: "Maria",
  middle_name: null,
  last_name: "Santos",
  email_address: "hr@abcc.example",
};

const hrRow = (overrides = {}) => ({
  us01_user_id: "9",
  us01_username: "hr.abcc",
  us01_first_name: "Maria",
  us01_email_address: "hr@abcc.example",
  us01_is_active: true,
  ...overrides,
});

// Records begin, each procedure, commit or rollback, and the email, in order.
const harness = ({ answers = {}, sendFails = false } = {}) => {
  const log = [];
  const sent = [];

  const { pool, calls } = fakePool({
    [COMPANY]: [company()],
    [HR_BY_COMPANY]: [hrRow()],
    [CREATE_USER]: () => ({ recordset: [], output: { us01_user_id: "9" } }),
    [ASSIGN_ROLE]: [],
    [MAP_HR]: [{ us08_user_employer_id: "7" }],
    ...answers,
  });

  const transaction = {
    begin: async () => log.push("begin"),
    commit: async () => log.push("commit"),
    rollback: async () => log.push("rollback"),
    request: () => {
      const request = pool.request();
      const execute = request.execute;
      request.execute = async (procedure) => {
        log.push(procedure);
        return execute(procedure);
      };
      return request;
    },
  };

  const send = (kind) => async (message) => {
    log.push(kind);
    sent.push(message);
    if (sendFails) throw Object.assign(new Error("Graph is down"), { status: 503 });
  };

  const deps = {
    newTransaction: () => transaction,
    sendHrAccountEmail: send("new-account email"),
    sendCredentialsEmail: send("credentials email"),
    endUserSessions: (userId) => log.push(`end sessions ${userId}`),
    newTemporaryPassword: () => "Temp-Pass-123",
  };

  return { pool, calls, log, sent, deps };
};

const silently = async (work) => {
  const original = console.error;
  console.error = () => {};
  try {
    return await work();
  } finally {
    console.error = original;
  }
};

describe("hrUsernameFor", () => {
  test("is hr. and the company code in lower case, as hr.coforge and hr.hcl are", () => {
    assert.equal(hrUsernameFor("ABCC"), "hr.abcc");
    assert.equal(hrUsernameFor("Coforge"), "hr.coforge");
    assert.equal(hrUsernameFor("NBS-2"), "hr.nbs-2");
  });
});

describe("HrAccountService.createHrAccount", () => {
  test("creates the user, gives it the HR role, maps it, commits, and only then emails", async () => {
    const { pool, log, deps } = harness();

    await HrAccountService.createHrAccount(pool, ADMIN_ID, "5", { ...person }, deps);

    assert.deepEqual(log, ["begin", CREATE_USER, ASSIGN_ROLE, MAP_HR, "commit", "new-account email"]);
  });

  test("the account: hr.<code>, a hashed password, a forced change, no client", async () => {
    const { pool, calls, deps } = harness();

    await HrAccountService.createHrAccount(pool, ADMIN_ID, "5", { ...person }, deps);

    const user = inputsFor(calls, CREATE_USER);
    assert.equal(user.us01_username, "hr.abcc");
    assert.equal(user.us01_must_change_password, 1);
    assert.equal(user.client_id, null);
    assert.equal(user.us01_email_address, "hr@abcc.example");
    assert.equal(user.us01_created_by, String(ADMIN_ID));
    assert.match(user.us01_password, /^\$2[aby]\$10\$/, "stored as a bcrypt hash");
    assert.notEqual(user.us01_password, "Temp-Pass-123");

    assert.equal(inputsFor(calls, ASSIGN_ROLE).us02_role_id, 2);

    const mapping = inputsFor(calls, MAP_HR);
    assert.equal(mapping.us01_user_id, ADMIN_ID);
    assert.equal(mapping.hr_us01_user_id, "9");
    assert.equal(mapping.employer_id, "5");
  });

  // HR signs in at the site's root (Adrian, 2026-10-14).
  test("the email carries the plain password and links to APP_URL itself", async () => {
    const { pool, sent, deps } = harness();

    const result = await HrAccountService.createHrAccount(pool, ADMIN_ID, "5", { ...person }, deps);

    assert.equal(sent[0].to, "hr@abcc.example");
    assert.equal(sent[0].username, "hr.abcc");
    assert.equal(sent[0].password, "Temp-Pass-123");
    assert.equal(sent[0].companyName, "Abacus Book and Card Corporation");
    assert.equal(sent[0].loginUrl, config.appUrl);
    assert.deepEqual(result, {
      user_id: "9",
      username: "hr.abcc",
      email_address: "hr@abcc.example",
      credentials_emailed: true,
    });
  });

  // The account exists either way. The answer says the email did not go, and
  // the Administrator reissues.
  test("a failed email leaves the account committed and says so", async () => {
    const { pool, log, deps } = harness({ sendFails: true });

    const result = await silently(() => HrAccountService.createHrAccount(pool, ADMIN_ID, "5", { ...person }, deps));

    assert.equal(result.credentials_emailed, false);
    assert.ok(log.indexOf("commit") < log.indexOf("new-account email"));
    assert.ok(!log.includes("rollback"));
  });

  test("a company that does not exist is 404, and nothing is begun", async () => {
    const { pool, log, deps } = harness({ answers: { [COMPANY]: [] } });

    await assert.rejects(
      () => HrAccountService.createHrAccount(pool, ADMIN_ID, "99", { ...person }, deps),
      (error) => error.statusCode === 404 && error.message === "Company not found",
    );
    assert.deepEqual(log, []);
  });

  test("a company that already has an HR account is 409, and nothing is begun", async () => {
    const { pool, log, deps } = harness({ answers: { [COMPANY]: [company({ hr_user_id: "2" })] } });

    await assert.rejects(
      () => HrAccountService.createHrAccount(pool, ADMIN_ID, "5", { ...person }, deps),
      (error) => error.statusCode === 409 && error.message === "This company already has an HR account",
    );
    assert.deepEqual(log, []);
  });

  // sec.us01_usp_ins_users answers 50035 and 50036 for everybody; the general
  // map words 50035 for an employee id. On this path they get their own.
  for (const [number, message] of [
    [50036, "That email address already belongs to another account"],
    [50035, "The username hr.abcc is already taken by another account"],
  ])
    test(`${number} from the user insert rolls back and is 409 "${message}", with no email`, async () => {
      const { pool, log, deps } = harness({
        answers: {
          [CREATE_USER]: () => {
            throw Object.assign(new Error("raw"), { number });
          },
        },
      });

      await assert.rejects(
        () => HrAccountService.createHrAccount(pool, ADMIN_ID, "5", { ...person }, deps),
        (error) => error.statusCode === 409 && error.message === message,
      );
      assert.deepEqual(log, ["begin", CREATE_USER, "rollback"]);
    });

  test("any other failure rolls back and is passed on unchanged", async () => {
    const failure = Object.assign(new Error("raw"), { number: 50197 });
    const { pool, log, deps } = harness({
      answers: {
        [MAP_HR]: () => {
          throw failure;
        },
      },
    });

    await assert.rejects(() => HrAccountService.createHrAccount(pool, ADMIN_ID, "5", { ...person }, deps), (error) => error === failure);
    assert.equal(log.at(-1), "rollback");
    assert.ok(!log.includes("new-account email"));
  });
});

describe("HrAccountService.resendHrCredentials", () => {
  test("sends first, then stores the password, then ends the sessions", async () => {
    const { pool, calls, log, deps } = harness();

    const result = await HrAccountService.resendHrCredentials(pool, ADMIN_ID, "5", deps);

    assert.equal(log[0], "credentials email");
    assert.ok(queryMatching(calls, RESET), "the password was not stored");
    assert.deepEqual(log.at(-1), "end sessions 9");
    assert.deepEqual(result, { email_address: "hr@abcc.example" });
  });

  test("the email links to APP_URL itself and names PhilLife as the issuer", async () => {
    const { pool, sent, deps } = harness();

    await HrAccountService.resendHrCredentials(pool, ADMIN_ID, "5", deps);

    assert.equal(sent[0].loginUrl, config.appUrl);
    assert.equal(sent[0].issuedBy, "PhilLife");
    assert.equal(sent[0].contact, "PhilLife");
    assert.equal(sent[0].username, "hr.abcc");
  });

  // The email is the only copy of the password, so a failed send must leave
  // the old one working.
  test("a failed send is 502 and changes nothing", async () => {
    const { pool, calls, log, deps } = harness({ sendFails: true });

    await silently(() =>
      assert.rejects(
        () => HrAccountService.resendHrCredentials(pool, ADMIN_ID, "5", deps),
        (error) => error.statusCode === 502 && /nothing was changed/.test(error.message),
      ),
    );
    assert.equal(queryMatching(calls, RESET), undefined);
    assert.ok(!log.some((entry) => entry.startsWith("end sessions")));
  });

  test("a company with no HR account is 404, and nothing is sent", async () => {
    const { pool, log, deps } = harness({ answers: { [HR_BY_COMPANY]: [] } });

    await assert.rejects(
      () => HrAccountService.resendHrCredentials(pool, ADMIN_ID, "5", deps),
      (error) => error.statusCode === 404 && error.message === "This company has no HR account yet",
    );
    assert.deepEqual(log, []);
  });

  // resetPassword only touches an active account, so a deactivated one would
  // be mailed a password that never works.
  test("a deactivated HR account is 409, and nothing is sent", async () => {
    const { pool, log, deps } = harness({ answers: { [HR_BY_COMPANY]: [hrRow({ us01_is_active: false })] } });

    await assert.rejects(
      () => HrAccountService.resendHrCredentials(pool, ADMIN_ID, "5", deps),
      (error) => error.statusCode === 409 && /deactivated/.test(error.message),
    );
    assert.deepEqual(log, []);
  });

  test("a company that does not exist is 404", async () => {
    const { pool, deps } = harness({ answers: { [COMPANY]: [] } });

    await assert.rejects(
      () => HrAccountService.resendHrCredentials(pool, ADMIN_ID, "99", deps),
      (error) => error.statusCode === 404 && error.message === "Company not found",
    );
  });
});
