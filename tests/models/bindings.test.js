import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";
import { callTo, declarationOf, fakePool } from "../helpers/fakePool.js";

import ClientModel from "../../src/models/clientModel.js";
import AddressModel from "../../src/models/addressModel.js";
import BeneficiaryModel from "../../src/models/beneficiaryModel.js";
import AgreementModel from "../../src/models/agreementModel.js";
import UserModel from "../../src/models/userModel.js";
import InvitationModel from "../../src/models/invitationModel.js";
import ReferenceModel from "../../src/models/referenceModel.js";
import ChangeRequestModel from "../../src/models/changeRequestModel.js";
import SignatureModel from "../../src/models/signatureModel.js";
import EmployerModel from "../../src/models/employerModel.js";
import ClaimModel from "../../src/models/claimModel.js";
import MessageModel from "../../src/models/messageModel.js";
import AuditTrailModel from "../../src/models/auditTrailModel.js";
import DeathModel from "../../src/models/deathModel.js";
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

    const { barangay_id } = callTo(calls, "bes.usp_ins_client_address").bindings;

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

    const { height, weight } = callTo(calls, "bes.usp_ins_client").bindings;

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

    const { coverage_percent } = callTo(calls, "bes.usp_ins_beneficiary").bindings;

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

    const { content, sha256 } = callTo(calls, "bes.usp_ins_client_signature").bindings;

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
    ["recordFailedLogin", (pool) => UserModel.recordFailedLogin(pool, 12, {})],
    ["recordSuccessfulLogin", (pool) => UserModel.recordSuccessfulLogin(pool, 12)],
    ["endSessions", (pool) => UserModel.endSessions(pool, 12)],
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
    ["insertClient", (pool) => ClientModel.insertClient(pool, {}), "bes.usp_ins_client", "client_id"],
    ["insertClientAddress", (pool) => AddressModel.insertClientAddress(pool, 75, {}), "bes.usp_ins_client_address", "client_address_id"],
    ["insertBeneficiary", (pool) => BeneficiaryModel.insertBeneficiary(pool, {}), "bes.usp_ins_beneficiary", "beneficiary_id"],
    ["createUser", (pool) => UserModel.createUser(pool, {}), "sec.us01_usp_ins_users", "us01_user_id"],
    ["createInvitation", (pool) => InvitationModel.createInvitation(pool, {}), "bes.usp_ins_enrollment_invitation", "invitation_id"],
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
      callTo(calls, "bes.usp_ins_client_signature").outputs.signature_id,
      "the call omits a mandatory parameter and SQL Server will refuse it",
    );
  });

  // The contrast, pinned so nobody tidies the two into agreement. The lockout
  // procedures from DBA request 18 take no output at all. That was asked for in
  // the request and read back from sys.parameters on 2026-10-06, so adding one
  // here would be the mirror of the mistake above.
  for (const [name, call] of [
    ["recordFailedLogin", (pool) => UserModel.recordFailedLogin(pool, 12, { maxAttempts: 8, lockMinutes: 15 })],
    ["recordSuccessfulLogin", (pool) => UserModel.recordSuccessfulLogin(pool, 12)],
    ["endSessions", (pool) => UserModel.endSessions(pool, 12)],
  ])
    test(`${name} declares no output at all`, async () => {
      const { pool, calls } = anyProcedure();

      await call(pool);

      assert.deepEqual(Object.keys(calls[0].outputs), []);
    });

  // DBA request 19's procedures have no output parameters (sys.parameters,
  // read 2026-10-06).
  for (const [name, call] of [
    ["getCocEmailSetting", (pool) => EmployerModel.getCocEmailSetting(pool, 96)],
    ["getEmployerSettings", (pool) => EmployerModel.getEmployerSettings(pool, 3)],
    ["getMessagingAccessByUser", (pool) => EmployerModel.getMessagingAccessByUser(pool, 3)],
    ["updateEmployerSettings", (pool) => EmployerModel.updateEmployerSettings(pool, { employerId: 1, sendCocEmail: false, messagesEnabled: true, userId: 3 })],
  ])
    test(`${name} declares no output at all`, async () => {
      const { pool, calls } = anyProcedure();

      await call(pool);

      assert.deepEqual(Object.keys(calls[0].outputs), []);
    });

  // A BIT, so false reaches the procedure as 0 rather than as a string.
  test("updateEmployerSettings binds the setting as a bit and the ids as BigInt", async () => {
    const { pool, calls } = anyProcedure();

    await EmployerModel.updateEmployerSettings(pool, { employerId: 1, sendCocEmail: false, messagesEnabled: true, userId: 3 });

    const { bindings } = callTo(calls, "bes.usp_upd_employer_settings");

    assert.equal(declarationOf(bindings.send_coc_email.type), declarationOf(sql.Bit));
    assert.equal(bindings.send_coc_email.value, false);
    assert.equal(declarationOf(bindings.messages_enabled.type), declarationOf(sql.Bit));
    assert.equal(bindings.messages_enabled.value, true);
    assert.equal(declarationOf(bindings.employer_id.type), declarationOf(sql.BigInt));
    assert.equal(declarationOf(bindings.us01_user_id.type), declarationOf(sql.BigInt));
  });

  // Resend-credentials is HR's way to unlock somebody at once. A reissued
  // password with any of these left set is a working password and a closed
  // door, with everything appearing to have worked.
  // The shared fakePool, because resetPassword reads rowsAffected and the local
  // recorder does not supply it.
  test("resetPassword clears the permanent lock, the count and the temporary lock", async () => {
    const { pool, calls } = fakePool({});

    await UserModel.resetPassword(pool, { us01_user_id: 12 });

    const { query } = calls[0];

    assert.match(query, /us01_is_locked\s*=\s*0/);
    assert.match(query, /us01_failed_login_attempts\s*=\s*0/);
    assert.match(query, /us01_locked_until\s*=\s*NULL/);
  });

  // And ends the sessions the old password had, in the same statement.
  test("resetPassword raises the token version", async () => {
    const { pool, calls } = fakePool({});

    await UserModel.resetPassword(pool, { us01_user_id: 12 });

    assert.match(calls[0].query, /us01_token_version\s*=\s*us01_token_version\s*\+\s*1/);
  });

  // The thresholds are ints, and the id is a BigInt like every user id.
  test("recordFailedLogin binds the thresholds as ints", async () => {
    const { pool, calls } = anyProcedure();

    await UserModel.recordFailedLogin(pool, 12, { maxAttempts: 8, lockMinutes: 15 });

    const { bindings } = callTo(calls, "sec.us01_usp_login_failed");

    assert.equal(declarationOf(bindings.max_attempts.type), declarationOf(sql.Int));
    assert.equal(declarationOf(bindings.lock_minutes.type), declarationOf(sql.Int));
    assert.equal(declarationOf(bindings.us01_user_id.type), declarationOf(sql.BigInt));
  });
});

// DBA request 20, read back 2026-10-12. The procedures return new ids in a
// result set and declare no OUTPUT parameter (sys.parameters, no rows).
describe("model bindings — claims", () => {
  const CLAIM_CALLS = [
    ["getClaimTypes", (pool) => ClaimModel.getClaimTypes(pool, "EMPLOYEE"), "bes.usp_sel_claim_types"],
    ["insertClaim", (pool) => ClaimModel.insertClaim(pool, {}), "bes.usp_ins_claim"],
    ["insertClaimDocument", (pool) => ClaimModel.insertClaimDocument(pool, {}), "bes.usp_ins_claim_document"],
    ["checkClaimRequirements", (pool) => ClaimModel.checkClaimRequirements(pool, 30), "bes.usp_chk_claim_requirements"],
    ["getClaimsByClient", (pool) => ClaimModel.getClaimsByClient(pool, 75), "bes.usp_sel_claims_by_client"],
    ["getClaimById", (pool) => ClaimModel.getClaimById(pool, 30, 12), "bes.usp_sel_claim_by_id"],
    ["getClaimDocument", (pool) => ClaimModel.getClaimDocument(pool, 9, 12), "bes.usp_sel_claim_document"],
    ["cancelClaim", (pool) => ClaimModel.cancelClaim(pool, {}), "bes.usp_upd_claim_cancel"],
    ["resubmitClaim", (pool) => ClaimModel.resubmitClaim(pool, 30, 75), "bes.usp_upd_claim_resubmit"],
    ["getClaimsByUser", (pool) => ClaimModel.getClaimsByUser(pool, 3, "PENDING", { page: 1, pageSize: 25 }), "bes.usp_sel_claims_by_user"],
    ["getPendingCountByUser", (pool) => ClaimModel.getPendingCountByUser(pool, 3), "bes.usp_sel_claims_pending_count_by_user"],
    ["reviewClaim", (pool) => ClaimModel.reviewClaim(pool, {}), "bes.usp_upd_claim_review"],
    // DBA request 21, read back 2026-10-12.
    ["fileDeathClaim", (pool) => ClaimModel.fileDeathClaim(pool, 40, 3), "bes.usp_upd_claim_file_death"],
    ["closeClaim", (pool) => ClaimModel.closeClaim(pool, 40, 3), "bes.usp_upd_claim_close"],
  ];

  for (const [name, call, procedure] of CLAIM_CALLS)
    test(`${name} calls ${procedure} and declares no output`, async () => {
      const { pool, calls } = anyProcedure();

      await call(pool);

      assert.ok(callTo(calls, procedure), `${name} does not call ${procedure}`);
      assert.deepEqual(Object.keys(callTo(calls, procedure).outputs), []);
    });

  // The signature travelled as a string into NVarChar(500) once, and every
  // one was cut at 500 characters with nothing reporting it.
  test("a document's content is bound as varbinary, its name as nvarchar and its hash as char(64)", async () => {
    const { pool, calls } = anyProcedure();

    await ClaimModel.insertClaimDocument(pool, { content: Buffer.from("%PDF-"), file_name: "Peña.pdf" });

    const { bindings } = callTo(calls, "bes.usp_ins_claim_document");

    assert.equal(declarationOf(bindings.content.type), "varbinary");
    assert.equal(declarationOf(bindings.file_name.type), "nvarchar");
    assert.equal(declarationOf(bindings.sha256.type), "char");
    assert.equal(declarationOf(bindings.claim_id.type), declarationOf(sql.BigInt));
    assert.equal(declarationOf(bindings.requirement_id.type), declarationOf(sql.BigInt));
  });

  test("insertClaim binds the ids as BigInt and the filer as text", async () => {
    const { pool, calls } = anyProcedure();

    await ClaimModel.insertClaim(pool, { client_id: "75", claim_type_id: "1", filed_by: "12", filed_by_role: "Employee" });

    const { bindings } = callTo(calls, "bes.usp_ins_claim");

    assert.equal(declarationOf(bindings.client_id.type), declarationOf(sql.BigInt));
    assert.equal(declarationOf(bindings.claim_type_id.type), declarationOf(sql.BigInt));
    assert.equal(declarationOf(bindings.filed_by.type), "varchar");
    assert.equal(bindings.filed_by_role.value, "Employee");
  });

  // The procedure names its column pending_count, unlike the change request
  // count's pendingCount. Read under the wrong name, the badge reads 0 forever.
  test("getPendingCountByUser reads pending_count", async () => {
    const pool = {
      request: () => {
        const chain = {
          input: () => chain,
          execute: async () => ({ recordset: [{ pending_count: 4 }] }),
        };
        return chain;
      },
    };

    assert.equal(await ClaimModel.getPendingCountByUser(pool, 3), 4);
  });

  test("reviewClaim binds the decision and the remarks as text, and the ids as BigInt", async () => {
    const { pool, calls } = anyProcedure();

    await ClaimModel.reviewClaim(pool, { claim_id: "30", us01_user_id: 3, decision: "RETURNED", review_remarks: "x" });

    const { bindings } = callTo(calls, "bes.usp_upd_claim_review");

    assert.equal(declarationOf(bindings.claim_id.type), declarationOf(sql.BigInt));
    assert.equal(declarationOf(bindings.us01_user_id.type), declarationOf(sql.BigInt));
    assert.equal(declarationOf(bindings.decision.type), "varchar");
    assert.equal(bindings.decision.value, "RETURNED");
    assert.equal(declarationOf(bindings.review_remarks.type), "varchar");
  });

  // Three result sets, read by position. An empty answer must still give
  // null and two empty lists, not a crash.
  test("getClaimById reads three result sets, and an empty answer is a null claim", async () => {
    const { pool } = anyProcedure();

    assert.deepEqual(await ClaimModel.getClaimById(pool, 30, 12), { claim: null, documents: [], requirements: [] });
  });
});

// DBA request 21, read back 2026-10-12. No OUTPUT parameters.
describe("model bindings — deceased status", () => {
  for (const [name, call, procedure] of [
    ["markDeceased", (pool) => DeathModel.markDeceased(pool, { clientId: "75", dateOfDeath: "2026-10-01", userId: 3 }), "bes.usp_upd_client_death"],
    ["undoDeceased", (pool) => DeathModel.undoDeceased(pool, { clientId: "75", userId: 1 }), "bes.usp_del_client_death"],
  ])
    test(`${name} calls ${procedure} and declares no output`, async () => {
      const { pool, calls } = anyProcedure();

      await call(pool);

      assert.ok(callTo(calls, procedure), `${name} does not call ${procedure}`);
      assert.deepEqual(Object.keys(callTo(calls, procedure).outputs), []);
    });

  // A date, bound from its "YYYY-MM-DD" text as the birthdate is. Bound as a
  // datetime, it would carry a time and a zone the column does not have.
  test("the date of death is bound as a date, and the ids as BigInt", async () => {
    const { pool, calls } = anyProcedure();

    await DeathModel.markDeceased(pool, { clientId: "75", dateOfDeath: "2026-10-01", userId: 3 });

    const { bindings } = callTo(calls, "bes.usp_upd_client_death");

    assert.equal(declarationOf(bindings.date_of_death.type), "date");
    assert.equal(bindings.date_of_death.value, "2026-10-01");
    assert.equal(declarationOf(bindings.client_id.type), declarationOf(sql.BigInt));
    assert.equal(declarationOf(bindings.us01_user_id.type), declarationOf(sql.BigInt));
  });
});

// DBA request 22, read back 2026-10-12. No OUTPUT parameters.
describe("model bindings — messaging", () => {
  const MESSAGE_CALLS = [
    ["openConversation", (pool) => MessageModel.openConversation(pool, 12), "bes.usp_ins_conversation"],
    ["insertMessage", (pool) => MessageModel.insertMessage(pool, { conversationId: 7, userId: 12, body: "hi" }), "bes.usp_ins_message"],
    ["getConversationsByUser", (pool) => MessageModel.getConversationsByUser(pool, 3, { page: 1, pageSize: 25 }), "bes.usp_sel_conversations_by_user"],
    ["getConversationById", (pool) => MessageModel.getConversationById(pool, 7, 12), "bes.usp_sel_conversation_by_id"],
    ["markConversationRead", (pool) => MessageModel.markConversationRead(pool, 7, 12, "120"), "bes.usp_upd_conversation_read"],
    ["getUnreadCountByUser", (pool) => MessageModel.getUnreadCountByUser(pool, 12), "bes.usp_sel_conversation_unread_count_by_user"],
  ];

  for (const [name, call, procedure] of MESSAGE_CALLS)
    test(`${name} calls ${procedure} and declares no output`, async () => {
      const { pool, calls } = anyProcedure();

      await call(pool);

      assert.ok(callTo(calls, procedure), `${name} does not call ${procedure}`);
      assert.deepEqual(Object.keys(callTo(calls, procedure).outputs), []);
    });

  // Wider than the column's 2000, so an overlong message reaches the
  // procedure whole and is refused (50175) rather than cut by the driver.
  // And nvarchar, because messages carry ñ and emoji.
  test("a message is bound as nvarchar(4000)", async () => {
    const { pool, calls } = anyProcedure();

    await MessageModel.insertMessage(pool, { conversationId: 7, userId: 12, body: "Salamat po 🙂" });

    const { body } = callTo(calls, "bes.usp_ins_message").bindings;

    assert.equal(declarationOf(body.type), "nvarchar");
    assert.equal(body.type.length, 4000);
  });

  // An employee opens their own conversation: the client id reaches the
  // procedure as NULL, and the procedure finds it from the caller.
  test("an employee's open sends no client id", async () => {
    const { pool, calls } = anyProcedure();

    await MessageModel.openConversation(pool, 12);

    assert.equal(callTo(calls, "bes.usp_ins_conversation").inputs.client_id, null);
  });

  test("the cursor reaches the procedure, and an empty answer is a null conversation", async () => {
    const { pool, calls } = anyProcedure();

    const result = await MessageModel.getConversationById(pool, 7, 12, { before: "120", limit: 20 });

    assert.deepEqual(result, { conversation: null, messages: [], hasMore: false });

    const { inputs, bindings } = callTo(calls, "bes.usp_sel_conversation_by_id");

    assert.equal(inputs.before_message_id, "120");
    assert.equal(inputs.limit, 20);
    assert.equal(declarationOf(bindings.before_message_id.type), declarationOf(sql.BigInt));
  });

  // has_more is a BIT, which the driver hands back as a boolean.
  test("has_more is read from the third result set, as true or 1", async () => {
    for (const flag of [true, 1]) {
      const pool = {
        request: () => {
          const chain = {
            input: () => chain,
            execute: async () => ({ recordsets: [[{ conversation_id: "7" }], [{ message_id: "120" }], [{ has_more: flag }]] }),
          };
          return chain;
        },
      };

      const result = await MessageModel.getConversationById(pool, 7, 12);

      assert.equal(result.hasMore, true, String(flag));
      assert.equal(result.messages.length, 1);
    }
  });

  test("the badge is read from unread_count", async () => {
    const pool = {
      request: () => {
        const chain = {
          input: () => chain,
          execute: async () => ({ recordset: [{ unread_count: 3 }] }),
        };
        return chain;
      },
    };

    assert.equal(await MessageModel.getUnreadCountByUser(pool, 12), 3);
  });
});

// Branch 6 of the onboarding effort. The class and the affiliate travel as
// bigint ids, NULL when absent: the procedures default both to NULL (DBA
// requests 23 and 25), and NULL is what "the company itself" is stored as.
describe("model bindings — the invitation's class and affiliate", () => {
  test("createInvitation binds both as BigInt, and NULL when not given", async () => {
    const { pool, calls } = anyProcedure();

    await InvitationModel.createInvitation(pool, {
      employer_id: "5", email_address: "juan@alakor.com.ph", token: "a".repeat(64), created_by: 3,
      classification_id: "54", affiliate_id: "7",
    });
    await InvitationModel.createInvitation(pool, {
      employer_id: "5", email_address: "ana@abcc.com.ph", token: "b".repeat(64), created_by: 3,
    });

    const [assigned, bare] = calls.filter((call) => call.procedure === "bes.usp_ins_enrollment_invitation");

    for (const field of ["classification_id", "affiliate_id"])
      assert.equal(declarationOf(assigned.bindings[field].type), declarationOf(sql.BigInt), field);
    assert.equal(assigned.inputs.classification_id, "54");
    assert.equal(assigned.inputs.affiliate_id, "7");
    assert.equal(bare.inputs.classification_id, null);
    assert.equal(bare.inputs.affiliate_id, null);

    // The id still comes back through the one output, as before.
    assert.deepEqual(Object.keys(assigned.outputs), ["invitation_id"]);
  });

  test("insertClientEmployer binds the affiliate as BigInt, and NULL when not given", async () => {
    const { pool, calls } = anyProcedure();

    await EmployerModel.insertClientEmployer(pool, { client_id: 9, employer_id: "5", position_title: "Clerk", is_current: true, affiliate_id: "7" });
    await EmployerModel.insertClientEmployer(pool, { client_id: 9, employer_id: "1", position_title: "Clerk", is_current: true });

    const [assigned, bare] = calls.filter((call) => call.procedure === "bes.usp_ins_client_employer");

    assert.equal(declarationOf(assigned.bindings.affiliate_id.type), declarationOf(sql.BigInt));
    assert.equal(assigned.inputs.affiliate_id, "7");
    assert.equal(bare.inputs.affiliate_id, null);
    assert.deepEqual(Object.keys(assigned.outputs), ["client_employer_id"]);
  });
});

// The audit row is written by an INSERT of our own, because sec.usp_ins_audit_log
// cannot insert one (docs/dba-handoff/AUDIT-LOG-SP.md); the session is opened by
// sec.us06_usp_ins_session. Both read on 2026-10-28.
//
// Going round the procedure means going round its checks, which were probed in
// transactions that were rolled back: an action other than I, U or D is refused
// (50203, L included), so is a record id that is not above zero (50205), and so
// is a session that is not a row of sec.us06_sessions (50206). insertAuditLog
// applies the first two itself, and needs a session.
describe("model bindings — the audit trail", () => {
  const AUDIT = { userId: 3, objectName: "Claim", recordId: "120", action: "U", ipAddress: "203.0.113.7", sessionId: 77 };

  // Answers the INSERT with the id it made, as OUTPUT inserted.* does.
  const auditPool = () => {
    const calls = [];
    const request = () => {
      const inputs = {};
      const bindings = {};
      const chain = {
        input(name, type, value) {
          inputs[name] = value;
          bindings[name] = { type, value };
          return chain;
        },
        async execute(procedure) {
          calls.push({ procedure, inputs, bindings });
          return { recordset: [], output: {} };
        },
        async query(text) {
          calls.push({ query: String(text).trim(), inputs, bindings });
          return { recordset: [{ audit_log_id: "9" }] };
        },
      };
      return chain;
    };

    return { pool: { request }, calls };
  };

  test("insertAuditLog inserts into sec.us07_audit_logs, and does not call the procedure that cannot", async () => {
    const { pool, calls } = auditPool();

    await AuditTrailModel.insertAuditLog(pool, AUDIT);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].procedure, undefined);
    assert.match(calls[0].query, /^INSERT INTO sec\.us07_audit_logs/);
    assert.match(calls[0].query, /OUTPUT inserted\.us07_audit_log_id/);
  });

  test("insertAuditLog hands back the id of the row it made", async () => {
    const { pool } = auditPool();

    assert.equal(await AuditTrailModel.insertAuditLog(pool, AUDIT), "9");
  });

  test("it sends every NOT NULL column: the six it is given, and {} for the old and new values", async () => {
    const { pool, calls } = auditPool();

    await AuditTrailModel.insertAuditLog(pool, AUDIT);

    const { inputs } = calls[0];

    assert.deepEqual(Object.keys(inputs).sort(), [
      "us01_user_id",
      "us06_session_id",
      "us07_action",
      "us07_ip_address",
      "us07_new_values",
      "us07_object_name",
      "us07_old_values",
      "us07_record_id",
    ]);
    // The cause of the procedure's failure: these two are NOT NULL.
    assert.equal(inputs.us07_old_values, "{}");
    assert.equal(inputs.us07_new_values, "{}");
  });

  test("what the caller gives as the old and new values is written, as JSON text", async () => {
    const { pool, calls } = auditPool();

    await AuditTrailModel.insertAuditLog(pool, {
      ...AUDIT,
      oldValues: { Status: "PENDING", "First Name": "Ana" },
      newValues: { Status: "APPROVED", "First Name": "Anna" },
    });

    const { inputs } = calls[0];

    assert.deepEqual(JSON.parse(inputs.us07_old_values), { Status: "PENDING", "First Name": "Ana" });
    assert.deepEqual(JSON.parse(inputs.us07_new_values), { Status: "APPROVED", "First Name": "Anna" });
  });

  // The columns are NOT NULL and the Audit Trail parses them as an object: a value
  // that is not one must not reach the table as "null" or "[]".
  for (const [name, values] of [["null", null], ["a list", [1, 2]], ["text", "changed"], ["a number", 5]])
    test(`old and new values that are ${name} are written as {}`, async () => {
      const { pool, calls } = auditPool();

      await AuditTrailModel.insertAuditLog(pool, { ...AUDIT, oldValues: values, newValues: values });

      assert.equal(calls[0].inputs.us07_old_values, "{}");
      assert.equal(calls[0].inputs.us07_new_values, "{}");
    });

  test("the ids are BigInt, the action is one character, and the widths are the columns'", async () => {
    const { pool, calls } = auditPool();

    await AuditTrailModel.insertAuditLog(pool, AUDIT);

    const { bindings } = calls[0];

    for (const field of ["us01_user_id", "us07_record_id", "us06_session_id"])
      assert.equal(declarationOf(bindings[field].type), declarationOf(sql.BigInt), field);

    assert.equal(declarationOf(bindings.us07_action.type), "char");
    assert.equal(bindings.us07_action.type.length, 1);
    assert.equal(declarationOf(bindings.us07_object_name.type), "varchar");
    assert.equal(bindings.us07_object_name.type.length, 100);
    assert.equal(declarationOf(bindings.us07_ip_address.type), "varchar");
    assert.equal(bindings.us07_ip_address.type.length, 45);
    for (const field of ["us07_old_values", "us07_new_values"]) {
      assert.equal(declarationOf(bindings[field].type), "nvarchar", field);
      assert.equal(bindings[field].type.length, sql.MAX, field);
    }
  });

  test("a record id is sent as the text it came as, so a large one is not rounded", async () => {
    const { pool, calls } = auditPool();

    await AuditTrailModel.insertAuditLog(pool, { ...AUDIT, recordId: "9007199254740993" });

    assert.equal(calls[0].inputs.us07_record_id, "9007199254740993");
  });

  for (const action of ["I", "U", "D"])
    test("the action " + action + " is accepted", async () => {
      const { pool, calls } = auditPool();

      await AuditTrailModel.insertAuditLog(pool, { ...AUDIT, action });

      assert.equal(calls[0].inputs.us07_action, action);
    });

  // Each of these reaches the database as nothing: the refusal comes first.
  const refused = [
    ["an action of L (a login), which the procedure refuses", { action: "L" }, /Unsupported audit action/],
    ["a lower-case action", { action: "u" }, /Unsupported audit action/],
    ["an action of two letters", { action: "UU" }, /Unsupported audit action/],
    ["no action", { action: undefined }, /Unsupported audit action/],
    ["a record id of 0", { recordId: 0 }, /Invalid record ID/],
    ["a record id of \"0\"", { recordId: "0" }, /Invalid record ID/],
    ["a negative record id", { recordId: "-4" }, /Invalid record ID/],
    ["a record id with text in it", { recordId: "12abc" }, /Invalid record ID/],
    ["a record id with a fraction", { recordId: "1.5" }, /Invalid record ID/],
    ["an empty record id", { recordId: "" }, /Invalid record ID/],
    ["no record id", { recordId: undefined }, /Invalid record ID/],
    ["a session of null", { sessionId: null }, /Invalid session ID/],
    ["a session of 0", { sessionId: 0 }, /Invalid session ID/],
    ["no session", { sessionId: undefined }, /Invalid session ID/],
  ];

  for (const [label, change, message] of refused)
    test("refuses " + label + ", before the database is asked", async () => {
      const { pool, calls } = auditPool();

      await assert.rejects(() => AuditTrailModel.insertAuditLog(pool, { ...AUDIT, ...change }), message);
      assert.equal(calls.length, 0);
    });

  test("createSession calls sec.us06_usp_ins_session with every column the procedure requires", async () => {
    const { pool, calls } = anyProcedure();

    await UserModel.createSession(pool, {
      userId: 12,
      accessKey: "a",
      refreshKey: "r",
      ipAddress: "203.0.113.7",
      userAgent: "agent",
      expiresAt: new Date("2026-10-29T08:00:00Z"),
      createdBy: "EMP-020",
    });

    const call = callTo(calls, "sec.us06_usp_ins_session");

    assert.ok(call, "createSession does not call sec.us06_usp_ins_session");
    assert.deepEqual(Object.keys(call.inputs).sort(), [
      "us01_user_id",
      "us06_access_token",
      "us06_created_by",
      "us06_device_id",
      "us06_expiration_date",
      "us06_ip_address",
      "us06_refresh_token",
      "us06_user_agent",
    ]);
    assert.deepEqual(Object.keys(call.outputs), []);
  });

  test("the session's tokens are unbounded text, and the device is sent as NULL", async () => {
    const { pool, calls } = anyProcedure();

    await UserModel.createSession(pool, {
      userId: 12, accessKey: "a", refreshKey: "r", ipAddress: null, userAgent: null,
      expiresAt: new Date(), createdBy: "EMP-020",
    });

    const { bindings, inputs } = callTo(calls, "sec.us06_usp_ins_session");

    assert.equal(declarationOf(bindings.us06_access_token.type), "nvarchar");
    assert.equal(bindings.us06_access_token.type.length, sql.MAX);
    assert.equal(inputs.us06_device_id, null);
    assert.equal(bindings.us06_user_agent.type.length, 500);
    assert.equal(bindings.us06_created_by.type.length, 50);
  });

  test("createSession answers the new id, and null when the procedure says it made none", async () => {
    const answers = (row) => ({
      request: () => {
        const chain = { input: () => chain, output: () => chain, execute: async () => ({ recordset: row ? [row] : [], output: {} }) };
        return chain;
      },
    });
    const args = { userId: 1, accessKey: "a", refreshKey: "r", ipAddress: null, userAgent: null, expiresAt: new Date(), createdBy: "x" };

    assert.equal(await UserModel.createSession(answers({ success: 1, sessionId: 5 }), args), 5);
    assert.equal(await UserModel.createSession(answers({ success: 0, sessionId: null }), args), null);
    assert.equal(await UserModel.createSession(answers(null), args), null);
  });
});
