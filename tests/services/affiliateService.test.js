import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";
import { callTo, declarationOf, fakePool, inputsFor } from "../helpers/fakePool.js";

const { default: AffiliateService, affiliateOf, hrAffiliateOf } = await import(
  "../../src/services/affiliateService.js"
);

// A company's affiliates, DBA request 25 Parts 3 and 4, read 2026-10-15 before
// delivery. The procedures refuse the wrong role, and check codes, names and
// references; what is tested here is what this side decides: the fields that
// leave, the 404s, how a PATCH becomes the whole record the procedure replaces,
// and which company HR's list answers for.

const LIST = "bes.usp_sel_employer_affiliates_admin";
const INSERT = "bes.usp_ins_employer_affiliate";
const UPDATE = "bes.usp_upd_employer_affiliate";
const HR_LIST = "bes.usp_sel_employer_affiliates_by_user";
const COMPANY = "bes.usp_sel_employer_admin_by_id";
const EMPLOYERS_BY_USER = "sec.us08_usp_sel_employers_by_user";

const ADMIN_ID = 1;
const HR_ID = 3;

// A row as usp_sel_employer_affiliates_admin returns it, values as the driver
// hands them over: bigints as strings, bits as booleans.
const stored = (overrides = {}) => ({
  affiliate_id: "7",
  employer_id: "5",
  affiliate_code: "ALAKOR",
  affiliate_name: "Alakor Corporation",
  reference_no: "G-TLI-26-177-1",
  is_active: true,
  created_by: "1",
  created_date: new Date("2026-10-15T00:00:00Z"),
  modified_by: null,
  modified_date: null,
  current_employees: 12,
  reference_locked: true,
  ...overrides,
});

const anvil = stored({
  affiliate_id: "8",
  affiliate_code: "ANVIL",
  affiliate_name: "Anvil Publishing",
  reference_no: null,
  current_employees: 0,
  reference_locked: false,
});

describe("affiliateOf — what the Administrator sees", () => {
  // Pinned as a literal: this is the Administrator's affiliate contract.
  test("answers with the named fields", () => {
    assert.deepEqual(Object.keys(affiliateOf(stored())).sort(), [
      "affiliate_code",
      "affiliate_id",
      "affiliate_name",
      "created_by",
      "created_date",
      "current_employees",
      "employer_id",
      "is_active",
      "modified_by",
      "modified_date",
      "reference_locked",
      "reference_no",
    ]);
  });

  test("a column a procedure gains later stays out", () => {
    const shown = affiliateOf(stored({ company_code: "ABCC", last_sequence: 41 }));

    assert.equal("company_code" in shown, false);
    assert.equal("last_sequence" in shown, false);
  });
});

describe("hrAffiliateOf — what HR sees", () => {
  // Pinned as a literal: what HR needs to write the code in its file.
  test("answers with the id, the code and the name, and nothing else", () => {
    assert.deepEqual(hrAffiliateOf({ ...stored(), employer_id: "5" }), {
      affiliate_id: "7",
      affiliate_code: "ALAKOR",
      affiliate_name: "Alakor Corporation",
    });
  });
});

describe("AffiliateService — the Administrator's list", () => {
  test("lists the company's affiliates, field by field, as the caller", async () => {
    const { pool, calls } = fakePool({ [COMPANY]: [{ employer_id: "5" }], [LIST]: [stored(), anvil] });

    const affiliates = await AffiliateService.getAffiliates(pool, ADMIN_ID, "5");

    assert.deepEqual(affiliates, [affiliateOf(stored()), affiliateOf(anvil)]);
    assert.deepEqual(inputsFor(calls, LIST), { us01_user_id: ADMIN_ID, employer_id: "5" });
  });

  // The list procedure answers an unknown company with no rows, which would
  // read as "this company has no affiliates".
  test("a company that does not exist is 404, not an empty list", async () => {
    const { pool, calls } = fakePool({ [COMPANY]: [], [LIST]: [] });

    await assert.rejects(
      () => AffiliateService.getAffiliates(pool, ADMIN_ID, "99"),
      (error) => error.statusCode === 404 && error.message === "Company not found",
    );
    assert.equal(callTo(calls, LIST), undefined);
  });
});

describe("AffiliateService — creating", () => {
  test("sends the affiliate as the caller, and answers it as stored", async () => {
    const { pool, calls } = fakePool({
      [INSERT]: [{ affiliate_id: "8" }],
      [LIST]: [stored(), anvil],
    });

    const created = await AffiliateService.createAffiliate(pool, ADMIN_ID, "5", {
      affiliate_code: "ANVIL",
      affiliate_name: "Anvil Publishing",
      reference_no: null,
    });

    assert.deepEqual(inputsFor(calls, INSERT), {
      us01_user_id: ADMIN_ID,
      employer_id: "5",
      affiliate_code: "ANVIL",
      affiliate_name: "Anvil Publishing",
      reference_no: null,
      created_by: String(ADMIN_ID),
    });

    // Read back by the id the procedure returned, not echoed.
    assert.deepEqual(created, affiliateOf(anvil));
  });

  // The procedure declares the code and the reference as varchar(50), wider
  // than their columns, so an overlong value reaches it whole and is refused
  // (50200, 50204). Bound at 20 it would be cut by the driver and stored.
  test("the code and the reference are bound at the procedure's width, not the column's", async () => {
    const { pool, calls } = fakePool({ [INSERT]: [{ affiliate_id: "8" }], [LIST]: [anvil] });

    await AffiliateService.createAffiliate(pool, ADMIN_ID, "5", {
      affiliate_code: "ANVIL",
      affiliate_name: "Anvil Publishing",
      reference_no: null,
    });

    const { bindings } = callTo(calls, INSERT);

    for (const [field, length] of [["affiliate_code", 50], ["affiliate_name", 200], ["reference_no", 50]]) {
      assert.equal(declarationOf(bindings[field].type), "varchar", field);
      assert.equal(bindings[field].type.length, length, field);
    }
  });
});

describe("AffiliateService — a PATCH becomes the whole affiliate", () => {
  const editing = (rows = [stored(), anvil], company = [{ employer_id: "5" }]) =>
    fakePool({
      [COMPANY]: company,
      [LIST]: rows,
      [UPDATE]: [{ affiliate_id: "7" }],
    });

  // The procedure replaces every field, so what was not sent must go back as
  // it is stored, or the PATCH would blank it.
  test("the fields not sent go back as stored; the ones sent replace them", async () => {
    const { pool, calls } = editing();

    await AffiliateService.updateAffiliate(pool, ADMIN_ID, "5", "7", { affiliate_name: "Alakor Corp." });

    assert.deepEqual(inputsFor(calls, UPDATE), {
      us01_user_id: ADMIN_ID,
      affiliate_id: "7",
      affiliate_code: "ALAKOR",
      affiliate_name: "Alakor Corp.",
      reference_no: "G-TLI-26-177-1",
      is_active: true,
      modified_by: String(ADMIN_ID),
    });
  });

  // null is a value here: the field was sent, to clear it.
  test("a reference sent as null clears it rather than keeping the stored one", async () => {
    const { pool, calls } = editing();

    await AffiliateService.updateAffiliate(pool, ADMIN_ID, "5", "7", { reference_no: null });

    assert.equal(inputsFor(calls, UPDATE).reference_no, null);
  });

  test("deactivating sends is_active false with everything else as stored", async () => {
    const { pool, calls } = editing();

    await AffiliateService.updateAffiliate(pool, ADMIN_ID, "5", "7", { is_active: false });

    const sent = inputsFor(calls, UPDATE);
    assert.equal(sent.is_active, false);
    assert.equal(sent.affiliate_code, "ALAKOR");
    assert.equal(sent.reference_no, "G-TLI-26-177-1");
  });

  // So modified_date keeps meaning "last changed then", and a locked
  // reference sent back unchanged is not a write at all.
  test("nothing is written when nothing would change, and the affiliate is answered as stored", async () => {
    const { pool, calls } = editing();

    const answered = await AffiliateService.updateAffiliate(pool, ADMIN_ID, "5", "7", {
      affiliate_code: "ALAKOR",
      reference_no: "G-TLI-26-177-1",
      is_active: true,
    });

    assert.equal(callTo(calls, UPDATE), undefined);
    assert.deepEqual(answered, affiliateOf(stored()));
  });

  // A change of case is a change: the procedure stores what it is sent.
  test("a code changed only in case is written", async () => {
    const { pool, calls } = editing();

    await AffiliateService.updateAffiliate(pool, ADMIN_ID, "5", "7", { affiliate_code: "Alakor" });

    assert.equal(inputsFor(calls, UPDATE).affiliate_code, "Alakor");
  });

  // Option A, 2026-10-15: the affiliate is found in its company's list.
  test("an affiliate of another company is 404, and nothing is written", async () => {
    const { pool, calls } = editing([anvil]);

    await assert.rejects(
      () => AffiliateService.updateAffiliate(pool, ADMIN_ID, "5", "7", { affiliate_name: "X" }),
      (error) => error.statusCode === 404 && error.message === "Affiliate not found",
    );
    assert.equal(callTo(calls, UPDATE), undefined);
  });

  test("a company that does not exist is 404, and nothing is read or written", async () => {
    const { pool, calls } = editing([stored()], []);

    await assert.rejects(
      () => AffiliateService.updateAffiliate(pool, ADMIN_ID, "99", "7", { affiliate_name: "X" }),
      (error) => error.statusCode === 404 && error.message === "Company not found",
    );
    assert.equal(callTo(calls, LIST), undefined);
    assert.equal(callTo(calls, UPDATE), undefined);
  });

  // The ids arrive from the URL as strings, and the driver may hand them back
  // as strings or numbers.
  test("the id is matched whatever type the driver returns it as", async () => {
    const { pool, calls } = editing([stored({ affiliate_id: 7 })]);

    await AffiliateService.updateAffiliate(pool, ADMIN_ID, "5", "7", { affiliate_name: "Alakor Corp." });

    assert.ok(callTo(calls, UPDATE));
  });
});

describe("AffiliateService.getForUser — HR's list", () => {
  const listFor = (employers) => {
    const { pool, calls } = fakePool({
      [EMPLOYERS_BY_USER]: employers,
      [HR_LIST]: [
        { employer_id: "5", affiliate_id: "7", affiliate_code: "ALAKOR", affiliate_name: "Alakor Corporation" },
        { employer_id: "5", affiliate_id: "8", affiliate_code: "ANVIL", affiliate_name: "Anvil Publishing" },
        { employer_id: "6", affiliate_id: "9", affiliate_code: "OTHER", affiliate_name: "Another Group's Affiliate" },
      ],
    });

    return { calls, result: AffiliateService.getForUser(pool, HR_ID) };
  };

  test("lists HR's own company's affiliates: id, code and name", async () => {
    const { calls, result } = listFor([{ employer_id: "5" }]);

    assert.deepEqual(await result, [
      { affiliate_id: "7", affiliate_code: "ALAKOR", affiliate_name: "Alakor Corporation" },
      { affiliate_id: "8", affiliate_code: "ANVIL", affiliate_name: "Anvil Publishing" },
    ]);
    assert.equal(inputsFor(calls, HR_LIST).us01_user_id, HR_ID);
  });

  // The company invitations are sent under (invitationService takes the
  // first), so the list HR sees is the one its file is checked against.
  test("an account mapped to two companies gets the first company's only", async () => {
    const { result } = listFor([{ employer_id: "6" }, { employer_id: "5" }]);

    assert.deepEqual(await result, [
      { affiliate_id: "9", affiliate_code: "OTHER", affiliate_name: "Another Group's Affiliate" },
    ]);
  });

  test("a company with no affiliates is an empty list", async () => {
    const { result } = listFor([{ employer_id: "1" }]);

    assert.deepEqual(await result, []);
  });

  test("an account with no company is 403, and no affiliate is read", async () => {
    const { calls, result } = listFor([]);

    await assert.rejects(
      () => result,
      (error) => error.statusCode === 403 && error.message === "No company is assigned to your account",
    );
    assert.equal(callTo(calls, HR_LIST), undefined);
  });
});
