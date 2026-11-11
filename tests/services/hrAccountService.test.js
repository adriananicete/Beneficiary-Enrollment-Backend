import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";
import { callTo, fakePool, inputsFor } from "../helpers/fakePool.js";

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
// A raw UPDATE until 2026-11-11; the procedure answers affected_count.
const RESET = "sec.usp_upd_user_password_reset";
const USERNAME_EXISTS = "sec.usp_sel_username_exists";

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
// `taken` is the usernames some account already holds, as
// sec.usp_sel_username_exists would find them.
const harness = ({ answers = {}, sendFails = false, taken = [] } = {}) => {
  const log = [];
  const sent = [];

  const { pool, calls } = fakePool({
    [COMPANY]: [company()],
    [HR_BY_COMPANY]: [hrRow()],
    [CREATE_USER]: () => ({ recordset: [], output: { us01_user_id: "9" } }),
    [ASSIGN_ROLE]: [],
    [MAP_HR]: [{ us08_user_employer_id: "7" }],
    [RESET]: [{ affected_count: 1 }],
    [USERNAME_EXISTS]: ({ username }) => ({
      recordset: taken.includes(username) ? [{ exists_flag: 1 }] : [],
      output: {},
    }),
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

  // The second and later accounts of a company, 2026-11-11. A company code
  // has no dot, so hr.nbs-2.2 can never be another company's first name.
  test("the second and later are hr.<code>.2, .3 and on", () => {
    assert.equal(hrUsernameFor("ABCC", 1), "hr.abcc");
    assert.equal(hrUsernameFor("ABCC", 2), "hr.abcc.2");
    assert.equal(hrUsernameFor("NBS-2", 3), "hr.nbs-2.3");
  });
});

describe("HrAccountService.nextHrUsername", () => {
  const next = (taken) => HrAccountService.nextHrUsername(harness({ taken }).pool, "ABCC");

  test("the first is hr.<code> when nobody has it", async () => {
    assert.equal(await next([]), "hr.abcc");
  });

  test("skips every name an account holds, in order", async () => {
    assert.equal(await next(["hr.abcc"]), "hr.abcc.2");
    assert.equal(await next(["hr.abcc", "hr.abcc.2"]), "hr.abcc.3");
  });

  // Counted against every username, not the company's listed accounts: a
  // deactivated or unmapped hr.abcc.2 is not listed, and still holds its name.
  // Offering it again was 409 on every try (the teammates' version).
  test("a gap is filled, and a name held outside the list is still skipped", async () => {
    assert.equal(await next(["hr.abcc.2"]), "hr.abcc");
    assert.equal(await next(["hr.abcc", "hr.abcc.3"]), "hr.abcc.2");
  });

  test("gives up with 409 rather than looping for ever", async () => {
    const every = Array.from({ length: 1000 }, (_, i) => hrUsernameFor("ABCC", i + 1));

    await assert.rejects(() => next(every), (error) => error.statusCode === 409);
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

  // Several per company since 2026-11-11: a company that has one gets another,
  // under the next free name.
  test("a company that has an HR account gets another, as hr.<code>.2", async () => {
    const { pool, calls, log, deps } = harness({
      answers: { [COMPANY]: [company({ hr_user_id: "2" })] },
      taken: ["hr.abcc"],
    });

    const result = await HrAccountService.createHrAccount(pool, ADMIN_ID, "5", { ...person }, deps);

    assert.equal(inputsFor(calls, CREATE_USER).us01_username, "hr.abcc.2");
    assert.equal(result.username, "hr.abcc.2");
    assert.deepEqual(log, ["begin", CREATE_USER, ASSIGN_ROLE, MAP_HR, "commit", "new-account email"]);
  });

  // The name is found before the transaction opens, so a lookup that fails
  // leaves nothing to roll back.
  test("the free name is looked up before anything is begun", async () => {
    const { pool, calls, deps } = harness();

    await HrAccountService.createHrAccount(pool, ADMIN_ID, "5", { ...person }, deps);

    const order = calls.map((call) => call.procedure);
    assert.ok(order.indexOf(USERNAME_EXISTS) < order.indexOf(CREATE_USER), order.join(" → "));
  });

  // sec.us01_usp_ins_users answers 50035 and 50036 for everybody; the general
  // map words 50035 for an employee id. On this path they get their own. 50035
  // here is two Administrators taking the same free name at once.
  for (const [number, message] of [
    [50036, "That email address already belongs to another account"],
    [50035, "The username hr.abcc was just taken by another account. Please try again."],
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

    const result = await HrAccountService.resendHrCredentials(pool, ADMIN_ID, "5", null, deps);

    assert.equal(log[0], "credentials email");
    assert.ok(callTo(calls, RESET), "the password was not stored");
    assert.deepEqual(log.at(-1), "end sessions 9");
    // The id and username are for the security event the controller records.
    assert.deepEqual(result, { email_address: "hr@abcc.example", user_id: "9", username: "hr.abcc" });
  });

  test("the email links to APP_URL itself and names PhilLife as the issuer", async () => {
    const { pool, sent, deps } = harness();

    await HrAccountService.resendHrCredentials(pool, ADMIN_ID, "5", null, deps);

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
        () => HrAccountService.resendHrCredentials(pool, ADMIN_ID, "5", null, deps),
        (error) => error.statusCode === 502 && /nothing was changed/.test(error.message),
      ),
    );
    assert.equal(callTo(calls, RESET), undefined);
    assert.ok(!log.some((entry) => entry.startsWith("end sessions")));
  });

  test("a company with no HR account is 404, and nothing is sent", async () => {
    const { pool, log, deps } = harness({ answers: { [HR_BY_COMPANY]: [] } });

    await assert.rejects(
      () => HrAccountService.resendHrCredentials(pool, ADMIN_ID, "5", null, deps),
      (error) => error.statusCode === 404 && error.message === "This company has no HR account yet",
    );
    assert.deepEqual(log, []);
  });

  // resetPassword only touches an active account, so a deactivated one would
  // be mailed a password that never works.
  test("a deactivated HR account is 409, and nothing is sent", async () => {
    const { pool, log, deps } = harness({ answers: { [HR_BY_COMPANY]: [hrRow({ us01_is_active: false })] } });

    await assert.rejects(
      () => HrAccountService.resendHrCredentials(pool, ADMIN_ID, "5", null, deps),
      (error) => error.statusCode === 409 && /deactivated/.test(error.message),
    );
    assert.deepEqual(log, []);
  });

  test("a company that does not exist is 404", async () => {
    const { pool, deps } = harness({ answers: { [COMPANY]: [] } });

    await assert.rejects(
      () => HrAccountService.resendHrCredentials(pool, ADMIN_ID, "99", null, deps),
      (error) => error.statusCode === 404 && error.message === "Company not found",
    );
  });
});

// Several HR accounts per company, 2026-11-11. A reissue names the account; the
// route without a name still serves a company with one.
describe("HrAccountService.resendHrCredentials — several accounts", () => {
  const TWO = [
    hrRow(),
    hrRow({ us01_user_id: "12", us01_username: "hr.abcc.2", us01_first_name: "Jose", us01_email_address: "jose@abcc.example" }),
  ];

  test("the named account is the one emailed, reset and signed out", async () => {
    const { pool, calls, log, sent, deps } = harness({ answers: { [HR_BY_COMPANY]: TWO } });

    const result = await HrAccountService.resendHrCredentials(pool, ADMIN_ID, "5", "12", deps);

    assert.equal(sent[0].to, "jose@abcc.example");
    assert.equal(sent[0].username, "hr.abcc.2");
    assert.equal(inputsFor(calls, RESET).us01_user_id, "12");
    assert.equal(log.at(-1), "end sessions 12");
    assert.deepEqual(result, { email_address: "jose@abcc.example", user_id: "12", username: "hr.abcc.2" });
  });

  // The id arrives from the path as text and the procedure's as a BigInt
  // string; a number must match as well.
  test("the id matches whether it arrives as text or a number", async () => {
    const { pool, sent, deps } = harness({ answers: { [HR_BY_COMPANY]: TWO } });

    await HrAccountService.resendHrCredentials(pool, ADMIN_ID, "5", 12, deps);

    assert.equal(sent[0].username, "hr.abcc.2");
  });

  // Another company's account, or none at all, is answered the same: this
  // company has no such account. Nothing is sent.
  test("an id that is not one of this company's accounts is 404, and nothing is sent", async () => {
    const { pool, calls, log, deps } = harness({ answers: { [HR_BY_COMPANY]: TWO } });

    await assert.rejects(
      () => HrAccountService.resendHrCredentials(pool, ADMIN_ID, "5", "99", deps),
      (error) => error.statusCode === 404 && error.message === "HR account not found for this company",
    );
    assert.deepEqual(log, []);
    assert.equal(callTo(calls, RESET), undefined);
  });

  // The route from before several were allowed cannot guess which.
  test("without a name, a company with several is 409, and nothing is sent", async () => {
    const { pool, log, deps } = harness({ answers: { [HR_BY_COMPANY]: TWO } });

    await assert.rejects(
      () => HrAccountService.resendHrCredentials(pool, ADMIN_ID, "5", null, deps),
      (error) => error.statusCode === 409 && /several HR accounts/.test(error.message),
    );
    assert.deepEqual(log, []);
  });

  test("a named account that is deactivated is still 409, and nothing is sent", async () => {
    const { pool, log, deps } = harness({
      answers: { [HR_BY_COMPANY]: [hrRow(), hrRow({ us01_user_id: "12", us01_is_active: false })] },
    });

    await assert.rejects(
      () => HrAccountService.resendHrCredentials(pool, ADMIN_ID, "5", "12", deps),
      (error) => error.statusCode === 409 && /deactivated/.test(error.message),
    );
    assert.deepEqual(log, []);
  });
});

describe("HrAccountService.getHrAccounts", () => {
  test("every account, named field by field, with no password column", async () => {
    const { pool } = harness({
      answers: { [HR_BY_COMPANY]: [hrRow({ us01_password: "$2b$10$secret", us01_is_locked: false, us01_must_change_password: true })] },
    });

    const [account] = await HrAccountService.getHrAccounts(pool, ADMIN_ID, "5");

    assert.deepEqual(Object.keys(account).sort(), [
      "email_address",
      "first_name",
      "is_active",
      "is_locked",
      "last_name",
      "middle_name",
      "must_change_password",
      "user_id",
      "username",
    ]);
    assert.equal("us01_password" in account, false);
  });
});
