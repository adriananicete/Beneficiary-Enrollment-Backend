import { describe, test } from "node:test";
import assert from "node:assert/strict";

// Must run before userModel is imported: its import chain reaches env.js, which
// throws on a missing variable. Dynamic import below for the same reason.
import "../helpers/env.js";

const { default: UserModel } = await import("../../src/models/userModel.js");

// The first model test in this suite, and it exists because src/config/db.js
// stopped connecting at import in PR #87. Before that, importing this file
// opened a database connection and called process.exit(1) on failure.
//
// No mocking library and no --experimental flag. The models already take their
// pool as the first argument, so a fake that records what was asked of it is
// enough — which is the argument in PARK.md §3 for passing the pool into
// controllers and services too, rather than reaching for mock.module.
const fakePool = () => {
  const calls = { inputs: [], outputs: [], executed: null };

  const request = {
    input(name, type, value) {
      calls.inputs.push({ name, type, value });
      return request;
    },
    output(name, type) {
      calls.outputs.push({ name, type });
      return request;
    },
    async execute(procedure) {
      calls.executed = procedure;
      // Faithful to mssql, and the fidelity is load-bearing. A declared OUTPUT
      // the procedure never sets comes back as null; one that was never
      // declared is simply absent. An earlier version of this fake returned
      // `{}` unconditionally, which made the "returns nothing" test below
      // unable to fail — it read undefined either way. Caught by restoring the
      // dead return and watching only one of two tests go red.
      return {
        recordset: [],
        output: Object.fromEntries(calls.outputs.map((o) => [o.name, null])),
      };
    },
  };

  return { pool: { request: () => request }, calls };
};

const inputNames = (calls) => calls.inputs.map((i) => i.name);
const outputNames = (calls) => calls.outputs.map((o) => o.name);

describe("UserModel.changePassword", () => {
  test("calls the first-login procedure with the three inputs it needs", async () => {
    const { pool, calls } = fakePool();

    await UserModel.changePassword(pool, {
      us01_username: "EMP-020",
      oldpass: "$2b$10$storedhash",
      newpass: "$2b$10$newhash",
    });

    assert.equal(calls.executed, "sec.us01_usp_first_login");
    assert.deepEqual(inputNames(calls), [
      "us01_username",
      "oldpass",
      "newpass",
    ]);
  });

  test("passes the stored hash as oldpass, not the typed password", async () => {
    // Load-bearing and easy to 'fix' wrongly. The procedure compares hashes
    // directly, so it needs the hash from the user row. The real verification
    // is the bcrypt.compare in passwordService before this is ever called.
    const { pool, calls } = fakePool();

    await UserModel.changePassword(pool, {
      us01_username: "EMP-020",
      oldpass: "$2b$10$storedhash",
      newpass: "$2b$10$newhash",
    });

    const oldpass = calls.inputs.find((i) => i.name === "oldpass");

    assert.match(oldpass.value, /^\$2b\$/);
  });

  // This test used to assert the opposite — `assert.deepEqual(calls.outputs, [])`
  // — and its comment called that "the point of this branch". It was green while
  // no employee could change their password.
  //
  // sec.us01_usp_first_login declares `@us01_user_id bigint output` with no
  // default, and an OUTPUT parameter without a default is mandatory: SQL Server
  // refuses the whole call with error 201 before the body runs. The value is
  // still meaningless — nothing assigns it — but the parameter is not optional.
  //
  // A fake pool cannot know that. It accepts whatever it is handed, so the
  // suite happily pinned a call the database rejects. This is `CLAUDE.md` §11
  // as a live example: no unit test sees a disagreement with a procedure this
  // repository does not own, and only the manual run found it.
  test("declares the output parameter the procedure demands", async () => {
    const { pool, calls } = fakePool();

    await UserModel.changePassword(pool, {
      us01_username: "EMP-020",
      oldpass: "x",
      newpass: "y",
    });

    assert.deepEqual(outputNames(calls), ["us01_user_id"]);
  });

  test("returns nothing, so a caller cannot read a null user id by accident", async () => {
    const { pool } = fakePool();

    const returned = await UserModel.changePassword(pool, {
      us01_username: "EMP-020",
      oldpass: "x",
      newpass: "y",
    });

    assert.equal(returned, undefined);
  });
});

describe("UserModel.createUser — the contrast, pinned on purpose", () => {
  // createUser carries the same .output(...) / return pair that was just
  // removed from changePassword, and it is correct here: us01_usp_ins_users
  // sets it with SCOPE_IDENTITY() after a real INSERT, and enrollmentService
  // uses the returned id to assign the role.
  //
  // Pinned so nobody tidies the two into agreement. They look identical and
  // only one of them was dead.
  test("declares the user id output and returns it", async () => {
    const { pool, calls } = fakePool();

    // Overridden so execute reports an id the way the real procedure does.
    const originalExecute = pool.request().execute;
    pool.request().execute = async (procedure) => {
      await originalExecute(procedure);
      return { recordset: [], output: { us01_user_id: 42 } };
    };

    const userId = await UserModel.createUser(pool, {
      us01_username: "EMP-099",
      us01_password: "$2b$10$hash",
      us01_first_name: "Angela",
      us01_middle_name: "",
      us01_last_name: "Bautista",
      us01_email_address: "angela@example.com",
      us01_created_by: "system",
      us01_must_change_password: 1,
      client_id: 7,
    });

    assert.equal(calls.executed, "sec.us01_usp_ins_users");
    assert.deepEqual(
      calls.outputs.map((o) => o.name),
      ["us01_user_id"],
    );
    assert.equal(userId, 42);
  });
});
