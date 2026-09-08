import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";
import { callTo, declarationOf } from "../helpers/fakePool.js";

import ClientModel from "../../src/models/clientModel.js";
import AddressModel from "../../src/models/addressModel.js";
import BeneficiaryModel from "../../src/models/beneficiaryModel.js";
import AgreementModel from "../../src/models/agreementModel.js";
import UserModel from "../../src/models/userModel.js";
import InvitationModel from "../../src/models/invitationModel.js";
import ReferenceModel from "../../src/models/referenceModel.js";
import ChangeRequestModel from "../../src/models/changeRequestModel.js";
import SignatureModel from "../../src/models/signatureModel.js";
import { sql } from "../../src/config/db.js";

// One file rather than nine, and deliberately so.
//
// Each model is a single procedure call with no branching, so a test asserting
// its parameter names is the source rewritten in another syntax — it restates
// the line above it and catches nothing. What is worth pinning is the handful
// of things that have actually gone wrong here, all of which look identical to
// correct code and all of which fail silently:
//
//   - a type that quietly destroys the value it carries
//   - a schema prefix that has been forgotten before
//   - an output parameter present where it must not be, or absent where the
//     procedure demands it — which broke every forced password change on
//     2026-09-08
//
// None of this proves the database will accept the call. Nothing here can: on
// the same day, a green test in this directory asserted a call SQL Server
// refuses outright. These pin our side of the contract, and only the manual run
// pins the other.

// A local recorder rather than the shared fakePool, and the difference is
// deliberate. The shared one throws for a procedure the test did not script,
// which is what makes a service quietly reading something unexpected show up.
// Here the procedure's answer is irrelevant — every assertion is about what was
// SENT — so every call succeeds and nothing has to be scripted.
const anyProcedure = () => {
  const calls = [];
  const request = () => {
    const inputs = {};
    const bindings = {};
    const outputs = {};

    const chain = {
      input(name, type, value) {
        inputs[name] = value;
        bindings[name] = { type, value };
        return chain;
      },
      output(name, type, value) {
        inputs[name] = value;
        outputs[name] = { type, value };
        return chain;
      },
      async execute(procedure) {
        calls.push({ procedure, inputs, bindings, outputs });
        return { recordset: [], output: {} };
      },
      async query(text) {
        calls.push({ query: String(text).trim(), inputs, bindings, outputs });
        return { recordset: [] };
      },
    };

    return chain;
  };

  return { pool: { request }, calls };
};

describe("model bindings — the types that destroy a value when they are wrong", () => {
  // The oldest trap in this project. barangay codes are VARCHAR and carry
  // meaningful leading zeros; bound as BigInt the zero is stripped, the
  // reference joins resolve to nothing, and NOTHING ERRORS. The address still
  // displays afterwards, because full_address and zip_code are stored
  // separately — only brgy_name, city_municipality_name, province_name and
  // region_name come back NULL, and only if somebody looks.
  //
  // Six fabricated codes and one stripped zero reached live data through this.
  test("barangay_id is bound as varchar, never as a number", async () => {
    const { pool, calls } = anyProcedure();

    await AddressModel.insertClientAddress(pool, 75, {
      barangay_id: "012801001",
      address_line: "45 Bonifacio St",
      zip_code: "6000",
      created_by: "system",
    });

    const { barangay_id } = callTo(calls, "usp_ins_client_address").bindings;

    assert.equal(declarationOf(barangay_id.type), "varchar");
    assert.notEqual(declarationOf(barangay_id.type), "bigint");
    assert.equal(barangay_id.value, "012801001", "the leading zero was lost");
  });

  test("the barangay existence check compares the code as given", async () => {
    const { pool, calls } = anyProcedure();

    await ReferenceModel.barangayExists(pool, "012801001");

    const { brgy_code } = calls[0].bindings;

    assert.equal(declarationOf(brgy_code.type), "varchar");
    assert.equal(brgy_code.value, "012801001");
  });

  // sql.Decimal without precision rounds 5.8 to 6. Every decimal this system
  // stores means something at two places: a height in centimetres, a weight in
  // kilogrammes, a coverage percentage that must total exactly 100.
  test("height and weight are Decimal(5, 2) on the enrollment path", async () => {
    const { pool, calls } = anyProcedure();

    await ClientModel.insertClient(pool, { height: 172.55, weight: 68.45 });

    const { height, weight } = callTo(calls, "usp_ins_client").bindings;

    for (const [name, binding] of [["height", height], ["weight", weight]]) {
      assert.equal(declarationOf(binding.type), "decimal", `${name} is not a decimal`);
      assert.equal(binding.type.precision, 5, `${name} has no precision`);
      assert.equal(binding.type.scale, 2, `${name} would round`);
    }
  });

  test("height and weight are Decimal(5, 2) on the change request path too", async () => {
    const { pool, calls } = anyProcedure();

    await ChangeRequestModel.insertChangeRequest(pool, {
      height: 172.55,
      weight: 68.45,
      beneficiaries_json: null,
      addresses_json: null,
    });

    const call = calls.find((c) => c.bindings.height);

    assert.equal(call.bindings.height.type.scale, 2);
    assert.equal(call.bindings.weight.type.scale, 2);
  });

  // The coverage rule is that the set totals exactly 100. A rounded percentage
  // breaks the arithmetic the whole rule rests on.
  test("coverage_percent is Decimal(5, 2)", async () => {
    const { pool, calls } = anyProcedure();

    await BeneficiaryModel.insertBeneficiary(pool, {
      enrollment_id: 54,
      full_name: "Juan Reyes",
      relationship: "Child",
      age: 9,
      coverage_percent: 33.33,
      created_by: "system",
    });

    const { coverage_percent } = callTo(calls, "usp_ins_beneficiary").bindings;

    assert.equal(coverage_percent.type.precision, 5);
    assert.equal(coverage_percent.type.scale, 2);
  });

  // The signature is the one binding in this codebase where getting the type
  // wrong has already destroyed data — as a string in an NVarChar(500), every
  // image submitted over four days was cut to 500 characters. Binary, and
  // unbounded, is the whole correction.
  test("the signature is bound as unbounded binary, never as text", async () => {
    const { pool, calls } = anyProcedure();

    await SignatureModel.insertSignature(pool, {
      content: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      sha256: "a".repeat(64),
    });

    const { content, sha256 } = callTo(calls, "dbo.usp_ins_client_signature").bindings;

    assert.equal(declarationOf(content.type), "varbinary");
    assert.notEqual(declarationOf(content.type), "nvarchar");
    assert.equal(content.type.length, sql.MAX, "the image has a length cap");

    // char(64) exactly, matching the column. A hex sha256 is always 64
    // characters, so a shorter binding would silently store a prefix — which is
    // the same failure in miniature, on the field whose whole job is to prove
    // the bytes were not altered.
    assert.equal(declarationOf(sha256.type), "char");
    assert.equal(sha256.type.length, 64);
  });

  // The consent record's version. It is hardcoded to 1.0 today and PARK.md §3
  // holds the open question about where it should come from — but whatever it
  // becomes, a version that rounds is a version that lies about what was agreed.
  test("agreement_version is Decimal(5, 2)", async () => {
    const { pool, calls } = anyProcedure();

    await AgreementModel.insertAgreements(pool, 75, {
      agreement_type: "privacy",
      agreement_version: 1.0,
      accepted: true,
      created_by: "system",
    });

    const call = calls.find((c) => c.bindings.agreement_version);

    assert.equal(call.bindings.agreement_version.type.scale, 2);
  });
});

describe("model bindings — the schema prefix", () => {
  // The sec schema uses prefixed naming and the prefix number refers to the
  // OWNING TABLE rather than the procedure — us04_usp_assign_role takes
  // @us02_role_id. Dropping the `sec.` is a mistake this project has made, and
  // it fails at run time with a procedure-not-found rather than at import.
  const secCalls = [
    ["createUser", (pool) => UserModel.createUser(pool, {})],
    ["assignRole", (pool) => UserModel.assignRole(pool, 12, {})],
    ["findUserByUsername", (pool) => UserModel.findUserByUsername(pool, "EMP-020")],
    ["findUserById", (pool) => UserModel.findUserById(pool, 12)],
    ["changePassword", (pool) => UserModel.changePassword(pool, {})],
    ["getEmployersByUser", (pool) => InvitationModel.getEmployersByUser(pool, 7)],
  ];

  for (const [name, call] of secCalls) {
    test(`${name} keeps the sec. prefix`, async () => {
      const { pool, calls } = anyProcedure();

      await call(pool);

      assert.match(
        calls[0].procedure,
        /^sec\./,
        `${name} calls ${calls[0].procedure} — the sec schema prefix is missing`,
      );
    });
  }
});

describe("model bindings — output parameters", () => {
  // Each of these follows a real INSERT and reads back the id SCOPE_IDENTITY()
  // produced. The caller uses the value, so a missing output is a silent
  // undefined rather than an error.
  const insertsReturningAnId = [
    ["insertClient", (pool) => ClientModel.insertClient(pool, {}), "usp_ins_client", "client_id"],
    ["insertClientAddress", (pool) => AddressModel.insertClientAddress(pool, 75, {}), "usp_ins_client_address", "client_address_id"],
    ["insertBeneficiary", (pool) => BeneficiaryModel.insertBeneficiary(pool, {}), "usp_ins_beneficiary", "beneficiary_id"],
    ["createUser", (pool) => UserModel.createUser(pool, {}), "sec.us01_usp_ins_users", "us01_user_id"],
    ["createInvitation", (pool) => InvitationModel.createInvitation(pool, {}), "usp_ins_enrollment_invitation", "invitation_id"],
  ];

  for (const [name, call, procedure, output] of insertsReturningAnId) {
    test(`${name} declares its ${output} output`, async () => {
      const { pool, calls } = anyProcedure();

      await call(pool);

      assert.ok(
        callTo(calls, procedure).outputs[output],
        `${name} does not declare ${output}, so the caller reads undefined`,
      );
    });
  }

  // This one is different from every other output in the file, and the
  // difference is the whole reason it is here.
  //
  // sec.us01_usp_first_login declares @us01_user_id output with no default,
  // which makes it MANDATORY — SQL Server refuses the call with error 201
  // before the body runs. Nothing inside assigns it, so the value is always
  // NULL and worth nothing.
  //
  // PR #90 read that correctly and removed the parameter from the call, which
  // broke every forced password change on main for a day. The value being
  // meaningless and the parameter being optional are two different facts.
  //
  // The test that shipped with PR #90 asserted the opposite of this one and was
  // green throughout. A fake pool cannot know a procedure's signature.
  test("changePassword declares the output its procedure demands, useless as the value is", async () => {
    const { pool, calls } = anyProcedure();

    await UserModel.changePassword(pool, {
      us01_username: "EMP-020",
      oldpass: "$2b$04$hash",
      newpass: "$2b$04$newhash",
    });

    assert.ok(
      callTo(calls, "sec.us01_usp_first_login").outputs.us01_user_id,
      "the call omits a mandatory parameter and SQL Server will refuse it outright",
    );
  });

  // The signature's own output, and it is the good kind. usp_ins_client_signature
  // sets it with scope_identity() after a real INSERT, and it is declared with
  // no default, so omitting it would be refused with error 201 — the same trap
  // as changePassword's, met on the first day rather than after a month.
  test("insertSignature declares the signature_id its procedure demands", async () => {
    const { pool, calls } = anyProcedure();

    await SignatureModel.insertSignature(pool, {});

    assert.ok(
      callTo(calls, "dbo.usp_ins_client_signature").outputs.signature_id,
      "the call omits a mandatory parameter and SQL Server will refuse it",
    );
  });

  // The contrast, pinned so nobody tidies the two into agreement. updateLastLogin
  // is a raw UPDATE with nothing to return, and adding an output here would be
  // the mirror of the mistake above.
  test("updateLastLogin declares no output at all", async () => {
    const { pool, calls } = anyProcedure();

    await UserModel.updateLastLogin(pool, "EMP-020");

    assert.deepEqual(Object.keys(calls[0].outputs), []);
  });
});
