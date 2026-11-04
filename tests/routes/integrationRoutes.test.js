import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

import "../helpers/env.js";
import { fakePool, inputsFor } from "../helpers/fakePool.js";
import { useClaimStore } from "../helpers/claimStore.js";
import { entry, setting, sha256 } from "../helpers/integrationKeys.js";

const { createIntegrationRoutes } = await import("../../src/routes/integrationRoutes.js");
const { errorHandler } = await import("../../src/middlewares/errorHandler.js");
const { integrationLimiter, INTEGRATION_CALLS_PER_MINUTE } = await import("../../src/middlewares/rateLimiter.js");
const { createFailureLimiter } = await import("../../src/middlewares/integrationFailureLimiter.js");
const { enqueueTransfer, getOutcome, getTransfer, recordTransfer, saveDetails } = await import("../../src/claims/detailsStore.js");

// The hand-off API over HTTP (docs/claims-details/CONTRACT.md): the claims web app's four calls, with
// the claim read through the existing procedures as the person who approved it.

const KEY = "claims-web-test-key-0001";
const OTHER_KEY = "claims-web-test-key-0002";
const BASE_PATH = "/api/v1/integration";

const BYTES = Buffer.from("%PDF-1.4 death certificate");

// usp_sel_claim_by_id's header for an approved death claim, every column it has: the ones that are
// for HR, or are user ids, must not reach the claims web app.
const HEADER = {
  claim_id: "30",
  client_id: "75",
  enrollment_id: "76",
  employee_name: "Maria Reyes Santos",
  email_address: "maria@example.com",
  claim_type_id: "10",
  claim_type_code: "DEATH",
  claim_type_desc: "Death claim",
  ends_coverage: true,
  claim_status: "APPROVED",
  filed_by: "12",
  filed_by_role: "Employee",
  filed_date: new Date("2026-10-12T02:00:00Z"),
  resubmitted_date: null,
  reviewed_by: "3",
  reviewed_date: new Date("2026-10-13T03:00:00Z"),
  review_remarks: null,
  cancelled_by: null,
  cancelled_date: null,
  cancel_remarks: null,
  closed_by: null,
  closed_date: null,
  ticket_status: null,
  ticket_reference: null,
};

const DOCUMENTS = [
  {
    claim_document_id: "55",
    claim_id: "30",
    requirement_id: "91",
    requirement_desc: "Death certificate",
    file_name: "death-certificate.pdf",
    mime_type: "application/pdf",
    byte_size: BYTES.length,
    uploaded_by: "12",
    uploaded_date: new Date("2026-10-12T02:00:00Z"),
  },
  {
    claim_document_id: "56",
    claim_id: "30",
    requirement_id: "92",
    requirement_desc: "Claimant's valid ID",
    file_name: "id-ñ.png",
    mime_type: "image/png",
    byte_size: 4,
    sha256: "a".repeat(64),
    uploaded_by: "12",
    uploaded_date: new Date("2026-10-12T02:00:00Z"),
  },
];

const DETAILS = {
  details: {
    claimant: { name: "Carlos Santos", relationship: "SPOUSE", contact_no: "09171234567" },
    event: { date: "2026-10-02" },
    condition: { immediate_cause: "Myocardial infarction", manner_of_death: "NATURAL" },
  },
  insured: { client_id: "75", full_name: "Maria Reyes Santos" },
  computed: { age_at_event: 35 },
  coverage: [{ code: "GTLIP", description: "Group Term Life Insurance Plan", amount: 500000, formula: null }],
};

// The approver is user 3. The procedures return a claim only to someone who may see it, so any other
// user gets the empty sets a claim that is not theirs comes back as.
const READER = "3";

let current;

const scripted = ({ header = HEADER, documents = DOCUMENTS } = {}) =>
  fakePool({
    "bes.usp_sel_claim_by_id": (inputs) =>
      inputs.us01_user_id === READER
        ? { recordsets: [[header], documents, []], recordset: [header] }
        : { recordsets: [[], [], []], recordset: [] },
    "bes.usp_sel_claim_document": (inputs) => {
      const row = DOCUMENTS.find((candidate) => candidate.claim_document_id === String(inputs.claim_document_id));
      const found = inputs.us01_user_id === READER && row ? [{ ...row, content: row.claim_document_id === "55" ? BYTES : Buffer.from("PNG!") }] : [];

      return { recordsets: [found], recordset: found };
    },
  });

// Whether the router asks for HTTPS: only production does, so a test turns it on.
let httpsOn = false;
const failures = createFailureLimiter();

let server;
let base;
let lines;
let originalLog;
let originalError;

before(async () => {
  originalLog = console.log;
  originalError = console.error;
  console.log = (...args) => lines.push(args.join(" "));
  console.error = () => {};

  const app = express();
  // One proxy in front, as in production: X-Forwarded-For is where a call came from and
  // X-Forwarded-Proto whether it was HTTPS. A call with neither is from the socket, 127.0.0.1.
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use(
    BASE_PATH,
    createIntegrationRoutes({ getPool: async () => current.pool, failures }),
  );
  app.use(errorHandler);

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}${BASE_PATH}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  console.log = originalLog;
  console.error = originalError;
});

beforeEach(async () => {
  lines = [];
  current = scripted();
  httpsOn = false;
  failures.reset();
  for (const name of ["claimsweb", "backup"]) await integrationLimiter.resetKey(`integration:${name}`);
});

afterEach(() => {});

// `ip` is the address the call comes from, as the proxy would say it; `https` that it came over HTTPS.
// Only a source other than this machine needs HTTPS, so while a test has httpsOn its calls come from a
// listed address, and a call that names its source address is over HTTPS unless it says otherwise.
const call = async (method, path, { key = KEY, body, headers = {}, ip, https } = {}) => {
  const from = ip ?? (httpsOn ? "10.1.2.3" : undefined);
  const secure = https ?? ip !== undefined;
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(key ? { "x-api-key": key } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(from ? { "x-forwarded-for": from } : {}),
      ...(secure ? { "x-forwarded-proto": "https" } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const raw = Buffer.from(await response.arrayBuffer());
  let json = null;
  try {
    json = JSON.parse(raw.toString("utf8"));
  } catch {
    // Not JSON: a file, or the default 404 page.
  }

  return { status: response.status, headers: response.headers, json, raw };
};

// Approved by user 3, with details kept, as HR's approval leaves it.
const approved = (id = "30") => {
  enqueueTransfer(id, { readerUserId: READER, claimTypeCode: "DEATH" });
  saveDetails(id, DETAILS);
};

// The claims web app's key can read and report; the backup key can only read.
const useKeys = () => {
  beforeEach(() => {
    process.env.INTEGRATION_ALLOWED_IPS = "127.0.0.1,::1,10.1.2.3";
    process.env.INTEGRATION_API_KEY_HASHES = setting(
      entry("claimsweb", KEY),
      entry("backup", OTHER_KEY, { scopes: "claims:read" }),
    );
  });
};

describe("with the details switch off the API is not there", () => {
  useClaimStore({ on: false });
  useKeys();

  test("every path is a 404, with or without a key, and never a 401", async () => {
    for (const [method, path] of [
      ["GET", "/claims"],
      ["GET", "/claims/30"],
      ["GET", "/claims/30/documents/55"],
      ["POST", "/claims/30/transfer"],
      ["GET", "/anything"],
    ])
      for (const key of [KEY, null, "wrong"]) {
        const { status } = await call(method, path, { key, body: method === "POST" ? { status: "SENT", reference: "R" } : undefined });

        assert.equal(status, 404, `${method} ${path} ${key}`);
      }

    assert.deepEqual(lines, [], "nothing is logged either: the API does not exist");
  });
});

describe("the key", () => {
  useClaimStore();
  useKeys();

  test("a call with no key, or a wrong one, is 401 with one message", async () => {
    const results = [
      await call("GET", "/claims", { key: null }),
      await call("GET", "/claims", { key: "claims-web-test-key-9999" }),
      await call("GET", "/claims", { key: "two words" }),
    ];

    for (const { status, json } of results) {
      assert.equal(status, 401);
      assert.deepEqual(json, { success: false, message: "Unauthorized: a valid API key is required." });
    }
  });

  test("every route needs it", async () => {
    for (const [method, path] of [
      ["GET", "/claims"],
      ["GET", "/claims/30"],
      ["GET", "/claims/30/documents/55"],
      ["POST", "/claims/30/transfer"],
    ])
      assert.equal((await call(method, path, { key: null })).status, 401, `${method} ${path}`);
  });

  // A signed-in person is not a service: the session cookie opens nothing here.
  test("a session cookie is not a key", async () => {
    const { status } = await call("GET", "/claims", { key: null, headers: { cookie: "token=abc.def.ghi" } });

    assert.equal(status, 401);
  });

  test("a held key works, with no cookie and no session", async () => {
    assert.equal((await call("GET", "/claims")).status, 200);
    assert.equal((await call("GET", "/claims", { key: OTHER_KEY })).status, 200);
  });

  test("a key taken out of the setting stops working at once", async () => {
    process.env.INTEGRATION_API_KEY_HASHES = entry("backup", OTHER_KEY, { scopes: "claims:read" });

    assert.equal((await call("GET", "/claims")).status, 401);
    assert.equal((await call("GET", "/claims", { key: OTHER_KEY })).status, 200);
  });

  test("each call is logged with when, the key's name, the source, the method, the path and the status, and never the key", async () => {
    await call("GET", "/claims?status=ALL&limit=5");
    await call("GET", "/claims/30");
    await call("GET", "/claims", { key: OTHER_KEY });
    await call("GET", "/claims", { key: "claims-web-test-key-9999" });
    // The line is written when the answer has gone out, which can be just after the client has it.
    await new Promise((resolve) => setImmediate(resolve));

    const TIME = "\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z";
    const expected = [
      `claimsweb 127.0.0.1 GET ${BASE_PATH}/claims 200`,
      `claimsweb 127.0.0.1 GET ${BASE_PATH}/claims/30 404`,
      `backup 127.0.0.1 GET ${BASE_PATH}/claims 200`,
      `unknown key 127.0.0.1 GET ${BASE_PATH}/claims 401`,
    ];

    assert.equal(lines.length, expected.length);
    expected.forEach((line, index) => assert.match(lines[index], new RegExp(`^${TIME} Integration call: ${line}$`)));

    const everything = lines.join("\n");
    for (const secret of [KEY, OTHER_KEY, "claims-web-test-key-9999"]) assert.equal(everything.includes(secret), false, secret);
  });

  test("is limited per key: 120 a minute, and one key's budget is not another's", async () => {
    assert.equal(INTEGRATION_CALLS_PER_MINUTE, 120);

    for (let count = 0; count < 120; count++) assert.equal((await call("GET", "/claims")).status, 200);

    const over = await call("GET", "/claims");
    assert.equal(over.status, 429);
    assert.equal(over.json.success, false);
    assert.equal(over.headers.get("cache-control"), "no-store");

    assert.equal((await call("GET", "/claims", { key: OTHER_KEY })).status, 200);
  });
});

describe("GET /claims: the queue", () => {
  useClaimStore();
  useKeys();

  test("is empty to begin with", async () => {
    const { status, json } = await call("GET", "/claims");

    assert.equal(status, 200);
    assert.deepEqual(json, { claims: [], next_after: null });
  });

  test("lists the claims waiting, in the contract's shape, and nothing else", async () => {
    approved("30");

    const { json } = await call("GET", "/claims");

    assert.equal(json.claims.length, 1);
    assert.deepEqual(Object.keys(json.claims[0]), ["claim_id", "claim_type_code", "profile", "approved_at", "status", "attempts"]);
    assert.equal(json.claims[0].claim_id, "30");
    assert.equal(json.claims[0].claim_type_code, "DEATH");
    assert.equal(json.claims[0].profile, "death");
    assert.equal(json.claims[0].status, "QUEUED");
    assert.equal(json.claims[0].attempts, 0);
    assert.match(json.claims[0].approved_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(json.next_after, null);
  });

  test("status picks the state, and ALL every one", async () => {
    for (const id of ["30", "31", "32"]) approved(id);
    recordTransfer("31", "SENT", "ARDCI-1");
    recordTransfer("32", "FAILED", undefined, "Policy not found");

    const ids = async (status) => (await call("GET", `/claims?status=${status}`)).json.claims.map((claim) => claim.claim_id);

    assert.deepEqual(await ids("QUEUED"), ["30"]);
    assert.deepEqual(await ids("SENT"), ["31"]);
    assert.deepEqual(await ids("FAILED"), ["32"]);
    assert.deepEqual(await ids("ALL"), ["30", "31", "32"]);
    assert.deepEqual((await call("GET", "/claims")).json.claims.map((claim) => claim.claim_id), ["30"], "QUEUED by default");
  });

  test("pages by limit and after, and the last page has no next", async () => {
    for (const id of ["30", "31", "32"]) approved(id);

    const first = (await call("GET", "/claims?limit=2")).json;
    assert.deepEqual(first.claims.map((claim) => claim.claim_id), ["30", "31"]);
    assert.equal(first.next_after, "31");

    const second = (await call("GET", `/claims?limit=2&after=${first.next_after}`)).json;
    assert.deepEqual(second.claims.map((claim) => claim.claim_id), ["32"]);
    assert.equal(second.next_after, null);
  });

  test("a query that is not valid is 400 and names the problem", async () => {
    for (const [query, message] of [
      ["status=PENDING", /status must be one of/],
      ["status=queued", /status must be one of/],
      ["limit=0", /limit must be a whole number from 1 to 100/],
      ["limit=101", /limit must be a whole number from 1 to 100/],
      ["limit=abc", /limit must be/],
      ["limit=-1", /limit must be/],
      ["limit=2.5", /limit must be/],
      ["after=abc", /after must be a claim id/],
      ["after=1.5", /after must be a claim id/],
    ]) {
      const { status, json } = await call("GET", `/claims?${query}`);

      assert.equal(status, 400, query);
      assert.match(json.message, message, query);
    }
  });

  test("limit 1 and 100 are the edges and both are allowed", async () => {
    assert.equal((await call("GET", "/claims?limit=1")).status, 200);
    assert.equal((await call("GET", "/claims?limit=100")).status, 200);
  });

  test("does not read the database: the list is the queue", async () => {
    approved("30");

    await call("GET", "/claims");

    assert.equal(current.calls.length, 0);
  });
});

describe("GET /claims/:claim_id: the package", () => {
  useClaimStore();
  useKeys();

  test("is the contract's package, field by field", async () => {
    approved("30");

    const { status, json } = await call("GET", "/claims/30");

    assert.equal(status, 200);
    assert.deepEqual(Object.keys(json), [
      "claim_id",
      "claim_type",
      "status",
      "filed_by_role",
      "filed_at",
      "reviewed_at",
      "review_remarks",
      "details",
      "documents",
      "transfer",
    ]);

    assert.equal(json.claim_id, "30");
    assert.deepEqual(json.claim_type, { code: "DEATH", description: "Death claim", profile: "death", ends_coverage: true });
    assert.equal(json.status, "APPROVED");
    assert.equal(json.filed_by_role, "Employee");
    assert.equal(json.filed_at, "2026-10-12T02:00:00.000Z");
    assert.equal(json.reviewed_at, "2026-10-13T03:00:00.000Z");
    assert.equal(json.review_remarks, null);

    assert.deepEqual(Object.keys(json.details), ["claimant", "event", "condition", "insured", "computed", "coverage"]);
    assert.equal(json.details.claimant.name, "Carlos Santos");
    assert.equal(json.details.coverage[0].code, "GTLIP");
  });

  test("describes each document, with a hash and where to download it", async () => {
    approved("30");

    const { json } = await call("GET", "/claims/30");

    assert.deepEqual(json.documents[0], {
      document_id: "55",
      requirement_id: "91",
      requirement: "Death certificate",
      file_name: "death-certificate.pdf",
      mime_type: "application/pdf",
      byte_size: BYTES.length,
      // The procedure's list did not carry it, so it is worked out from the file.
      sha256: sha256(BYTES),
      download: `${BASE_PATH}/claims/30/documents/55`,
    });
    assert.equal(json.documents[1].sha256, "a".repeat(64), "the stored hash is used when the list has one");
    assert.equal(json.documents[1].file_name, "id-ñ.png");
  });

  test("says where the transfer stands, and not who BES reads the claim as", async () => {
    approved("30");

    const { json } = await call("GET", "/claims/30");

    assert.deepEqual(Object.keys(json.transfer), ["status", "queued_at", "attempts", "reference", "last_error"]);
    assert.equal(json.transfer.status, "QUEUED");
    assert.equal(json.transfer.attempts, 0);
    assert.equal(json.transfer.reference, null);
  });

  test("carries nothing of the header that is for HR", async () => {
    approved("30");

    const text = (await call("GET", "/claims/30")).raw.toString("utf8");

    for (const hidden of [
      "maria@example.com",
      '"email_address"',
      '"employee_name"',
      '"enrollment_id"',
      '"filed_by"',
      '"reviewed_by"',
      '"ticket_status"',
      '"ticket_reference"',
      "reader_user_id",
      '"3"',
    ])
      assert.equal(text.includes(hidden), false, hidden);
  });

  test("a claim with no details kept answers details: null", async () => {
    enqueueTransfer("30", { readerUserId: READER, claimTypeCode: "DEATH" });

    const { json } = await call("GET", "/claims/30");

    assert.equal(json.details, null);
  });

  test("is read as the person who approved it", async () => {
    approved("30");

    await call("GET", "/claims/30");

    assert.equal(inputsFor(current.calls, "bes.usp_sel_claim_by_id").us01_user_id, READER);
    assert.equal(inputsFor(current.calls, "bes.usp_sel_claim_by_id").claim_id, "30");
  });

  test("a claim that was never approved is 404", async () => {
    const { status, json } = await call("GET", "/claims/30");

    assert.equal(status, 404);
    assert.deepEqual(json, { success: false, message: "Claim not found" });
    assert.equal(current.calls.length, 0, "no transfer, so nothing is read");
  });

  test("a claim that is no longer APPROVED is 404", async () => {
    approved("30");

    for (const claim_status of ["PENDING", "RETURNED", "REJECTED", "CANCELLED", "CLOSED"]) {
      current = scripted({ header: { ...HEADER, claim_status } });

      assert.equal((await call("GET", "/claims/30")).status, 404, claim_status);
    }
  });

  test("a claim the approver can no longer see is 404, like one that does not exist", async () => {
    enqueueTransfer("30", { readerUserId: "99", claimTypeCode: "DEATH" });

    const { status, json } = await call("GET", "/claims/30");

    assert.equal(status, 404);
    assert.equal(json.message, "Claim not found");
  });

  test("an id that cannot be one is 404 before anything is read", async () => {
    for (const id of ["abc", "1.5", "9".repeat(19)]) {
      assert.equal((await call("GET", `/claims/${id}`)).status, 404, id);
    }
    assert.equal(current.calls.length, 0);
  });
});

describe("GET /claims/:claim_id/documents/:document_id", () => {
  useClaimStore();
  useKeys();

  test("is the file itself, with its type, name and hash", async () => {
    approved("30");

    const { status, headers, raw } = await call("GET", "/claims/30/documents/55");

    assert.equal(status, 200);
    assert.deepEqual(raw, BYTES);
    assert.equal(headers.get("content-type"), "application/pdf");
    assert.equal(headers.get("content-length"), String(BYTES.length));
    assert.match(headers.get("content-disposition"), /^attachment; filename="death-certificate\.pdf"/);
    assert.equal(headers.get("x-content-sha256"), sha256(BYTES));
  });

  // The file is saved and never shown or sniffed into another type; and kept by nobody.
  test("is an attachment, not to be sniffed, and not to be kept", async () => {
    approved("30");

    const { headers } = await call("GET", "/claims/30/documents/55");

    assert.match(headers.get("content-disposition"), /^attachment;/);
    assert.doesNotMatch(headers.get("content-disposition"), /inline/);
    assert.equal(headers.get("x-content-type-options"), "nosniff");
    assert.equal(headers.get("cache-control"), "no-store");
    assert.equal(headers.get("pragma"), "no-cache");
    assert.equal(headers.get("content-type"), "application/pdf");
  });

  test("a file name with letters outside ASCII is carried in filename*", async () => {
    approved("30");

    const { headers } = await call("GET", "/claims/30/documents/56");

    assert.match(headers.get("content-disposition"), /^attachment; .*filename\*=UTF-8''id-%C3%B1\.png/);
  });

  test("the hash in the header is of the bytes sent, so a caller can check what arrived", async () => {
    approved("30");

    const { headers, raw } = await call("GET", "/claims/30/documents/56");

    assert.equal(headers.get("x-content-sha256"), sha256(raw));
  });

  test("is read as the person who approved the claim", async () => {
    approved("30");

    await call("GET", "/claims/30/documents/55");

    assert.equal(inputsFor(current.calls, "bes.usp_sel_claim_document").us01_user_id, READER);
  });

  test("a document of another claim is 404, whatever the URL pairs it with", async () => {
    approved("30");
    approved("31");
    current = fakePool({
      "bes.usp_sel_claim_by_id": (inputs) => ({ recordsets: [[{ ...HEADER, claim_id: String(inputs.claim_id) }], [], []], recordset: [HEADER] }),
      "bes.usp_sel_claim_document": () => ({
        recordsets: [[{ ...DOCUMENTS[0], claim_id: "30", content: BYTES }]],
        recordset: [{ ...DOCUMENTS[0], claim_id: "30", content: BYTES }],
      }),
    });

    const { status, json } = await call("GET", "/claims/31/documents/55");

    assert.equal(status, 404);
    assert.equal(json.message, "Document not found");
  });

  test("a document that does not exist, or a claim that is not approved, is 404", async () => {
    approved("30");
    assert.equal((await call("GET", "/claims/30/documents/999")).status, 404);

    current = scripted({ header: { ...HEADER, claim_status: "CLOSED" } });
    assert.equal((await call("GET", "/claims/30/documents/55")).status, 404);

    assert.equal((await call("GET", "/claims/77/documents/55")).status, 404, "never queued");
  });

  test("ids that cannot be ids are 404 before anything is read", async () => {
    for (const path of ["/claims/abc/documents/55", "/claims/30/documents/abc", "/claims/30/documents/1.5"])
      assert.equal((await call("GET", path)).status, 404, path);

    assert.equal(current.calls.length, 0);
  });
});

describe("POST /claims/:claim_id/transfer", () => {
  useClaimStore();
  useKeys();

  const report = (body, id = "30", options = {}) => call("POST", `/claims/${id}/transfer`, { body, ...options });

  test("SENT with a reference is recorded, and the claim leaves the queue", async () => {
    approved("30");

    const { status, json } = await report({ status: "SENT", reference: "ARDCI-2026-0412" });

    assert.equal(status, 200);
    assert.equal(json.claim_id, "30");
    assert.deepEqual(Object.keys(json.transfer), ["status", "queued_at", "attempts", "reference", "last_error"]);
    assert.equal(json.transfer.status, "SENT");
    assert.equal(json.transfer.reference, "ARDCI-2026-0412");
    assert.equal(json.transfer.attempts, 1);

    assert.deepEqual((await call("GET", "/claims")).json.claims, []);
    assert.equal((await call("GET", "/claims/30")).json.transfer.reference, "ARDCI-2026-0412");
  });

  test("repeating the same SENT is accepted and changes nothing", async () => {
    approved("30");
    await report({ status: "SENT", reference: "ARDCI-2026-0412" });
    const before = getTransfer("30");

    const again = await report({ status: "SENT", reference: "ARDCI-2026-0412" });

    assert.equal(again.status, 200);
    assert.equal(again.json.transfer.attempts, 1);
    assert.deepEqual(getTransfer("30"), before);
  });

  test("a different reference for a claim already SENT is 409", async () => {
    approved("30");
    await report({ status: "SENT", reference: "ARDCI-2026-0412" });

    const { status, json } = await report({ status: "SENT", reference: "ARDCI-2026-9999" });

    assert.equal(status, 409);
    assert.equal(json.success, false);
    assert.equal(getTransfer("30").reference, "ARDCI-2026-0412");
  });

  test("FAILED is recorded with its reason, and the claim can be tried again", async () => {
    approved("30");

    const failed = await report({ status: "FAILED", error: "Policy not found" });
    assert.equal(failed.status, 200);
    assert.equal(failed.json.transfer.status, "FAILED");
    assert.equal(failed.json.transfer.last_error, "Policy not found");
    assert.deepEqual((await call("GET", "/claims?status=FAILED")).json.claims.map((claim) => claim.claim_id), ["30"]);

    const sent = await report({ status: "SENT", reference: "ARDCI-2026-0412" });
    assert.equal(sent.json.transfer.status, "SENT");
    assert.equal(sent.json.transfer.last_error, null);
    assert.equal(sent.json.transfer.attempts, 2);
  });

  test("a SENT claim cannot go back to FAILED", async () => {
    approved("30");
    await report({ status: "SENT", reference: "ARDCI-2026-0412" });

    const { status } = await report({ status: "FAILED", error: "Late" });

    assert.equal(status, 409);
    assert.equal(getTransfer("30").status, "SENT");
  });

  test("a report that is not valid is 400, and nothing is recorded", async () => {
    approved("30");

    for (const body of [
      {},
      { status: "QUEUED" },
      { status: "sent", reference: "R" },
      { status: "SENT" },
      { status: "SENT", reference: "" },
      { status: "SENT", reference: "   " },
      { status: "SENT", reference: 42 },
      { status: "SENT", reference: "x".repeat(101) },
      { status: "FAILED" },
      { status: "FAILED", error: "" },
      { status: "FAILED", error: "x".repeat(501) },
      { status: ["SENT"], reference: "R" },
    ]) {
      const { status } = await report(body);

      assert.equal(status, 400, JSON.stringify(body).slice(0, 80));
    }

    assert.equal(getTransfer("30").status, "QUEUED");
    assert.equal(getTransfer("30").attempts, 0);
  });

  test("a reference of 100 and an error of 500 characters are the edges and are allowed", async () => {
    approved("30");
    approved("31");

    assert.equal((await report({ status: "SENT", reference: "r".repeat(100) })).status, 200);
    assert.equal((await report({ status: "FAILED", error: "e".repeat(500) }, "31")).status, 200);
  });

  test("text is trimmed", async () => {
    approved("30");

    const { json } = await report({ status: "SENT", reference: "  ARDCI-1  " });

    assert.equal(json.transfer.reference, "ARDCI-1");
  });

  test("a claim that was never approved is 404", async () => {
    assert.equal((await report({ status: "SENT", reference: "R" })).status, 404);
  });

  test("a claim that is no longer APPROVED is 404 and nothing is recorded", async () => {
    approved("30");
    current = scripted({ header: { ...HEADER, claim_status: "RETURNED" } });

    assert.equal((await report({ status: "SENT", reference: "R" })).status, 404);
    assert.equal(getTransfer("30").status, "QUEUED");
  });

  test("an id that cannot be one is 404", async () => {
    assert.equal((await report({ status: "SENT", reference: "R" }, "abc")).status, 404);
  });

  test("needs the key", async () => {
    approved("30");

    assert.equal((await report({ status: "SENT", reference: "R" }, "30", { key: null })).status, 401);
    assert.equal(getTransfer("30").status, "QUEUED");
  });

  test("changes nothing but the transfer: no claim procedure that writes is called", async () => {
    approved("30");

    await report({ status: "SENT", reference: "R" });

    for (const call of current.calls)
      assert.match(call.procedure, /usp_sel_/, `${call.procedure} is not a read`);
  });
});

describe("POST /claims/:claim_id/outcome", () => {
  useClaimStore();
  useKeys();

  const report = (body, id = "30", options = {}) => call("POST", `/claims/${id}/outcome`, { body, ...options });
  const FULL = { status: "Paid-Partial", status_updated: "2026-11-20", total_claim_amount: 50000, amount_paid: 35000, denial_reason: "ADB denied" };

  test("is kept, and answered with all of it", async () => {
    approved("30");

    const { status, json } = await report(FULL);

    assert.equal(status, 200);
    assert.equal(json.claim_id, "30");
    assert.equal(json.outcome.status, "Paid-Partial");
    assert.equal(json.outcome.amount_paid, 35000);
    assert.equal(getOutcome("30").total_claim_amount, 50000);
  });

  test("a new report replaces the last", async () => {
    approved("30");
    await report(FULL);

    await report({ status: "Paid", amount_paid: 50000 });

    assert.deepEqual(Object.keys(getOutcome("30")).sort(), ["amount_paid", "reported_at", "status"]);
  });

  test("a report that breaks a rule is 400 with every field named, and nothing is kept", async () => {
    approved("30");

    const { status, json } = await report({ status: 5, amount_paid: -1, fax: 1 });

    assert.equal(status, 400);
    assert.deepEqual(Object.keys(json.errors).sort(), ["amount_paid", "fax", "status"]);
    assert.equal(getOutcome("30"), null);
  });

  test("an empty report is 400", async () => {
    approved("30");

    assert.equal((await report({})).status, 400);
    assert.equal(getOutcome("30"), null);
  });

  test("a claim that was never approved, or no longer is, is 404 and nothing is kept", async () => {
    assert.equal((await report(FULL, "31")).status, 404);

    approved("30");
    current = scripted({ header: { ...HEADER, claim_status: "RETURNED" } });
    assert.equal((await report(FULL)).status, 404);
    assert.equal(getOutcome("30"), null);
  });

  test("an id that cannot be one is 404", async () => {
    assert.equal((await report(FULL, "abc")).status, 404);
  });

  test("needs the key, and a key that may only read cannot report", async () => {
    approved("30");

    assert.equal((await report(FULL, "30", { key: null })).status, 401);
    assert.equal((await report(FULL, "30", { key: OTHER_KEY })).status, 403);
    assert.equal(getOutcome("30"), null);
  });

  test("changes nothing but the outcome: no claim procedure that writes is called", async () => {
    approved("30");

    await report(FULL);

    for (const call of current.calls) assert.match(call.procedure, /usp_sel_/, `${call.procedure} is not a read`);
  });
});

// ---- Security of the hand-off API (docs/claims-details/CONTRACT.md, pass 2) -----------------------

describe("the source address", () => {
  useClaimStore();
  useKeys();

  test("a source that is not listed gets 404, with or without a key, and is not logged", async () => {
    process.env.INTEGRATION_ALLOWED_IPS = "10.1.2.0/24";

    for (const key of [KEY, null, "wrong"]) {
      const { status } = await call("GET", "/claims", { key, ip: "192.168.9.9" });

      assert.equal(status, 404, String(key));
    }

    assert.deepEqual(lines, []);
  });

  // A caller must not be able to tell "not allowed" from "not there": a listed source with a good key
  // asking for a path the router does not have gets the same page.
  test("the 404 is the very answer of a path that was never declared", async () => {
    process.env.INTEGRATION_ALLOWED_IPS = "10.1.2.0/24";

    const refused = await call("GET", "/claims", { ip: "192.168.9.9" });
    const missing = await call("GET", "/does-not-exist", { ip: "10.1.2.3" });

    assert.equal(refused.status, 404);
    assert.equal(missing.status, 404);
    assert.equal(refused.raw.toString("utf8").replace("/claims", "X"), missing.raw.toString("utf8").replace("/does-not-exist", "X"));
    assert.equal(refused.headers.get("cache-control"), null, "no header tells it from a path that is not there");
  });

  test("the 404 is the same body as when the switch is off", async () => {
    process.env.INTEGRATION_ALLOWED_IPS = "10.1.2.0/24";
    const notListed = await call("GET", "/claims", { ip: "192.168.9.9" });

    delete process.env.CLAIM_DETAILS_DEV_STORE;
    const switchedOff = await call("GET", "/claims", { ip: "10.1.2.3" });

    assert.equal(notListed.status, 404);
    assert.equal(switchedOff.status, 404);
    assert.deepEqual(notListed.raw, switchedOff.raw);
    assert.equal(notListed.headers.get("content-type"), switchedOff.headers.get("content-type"));
  });

  test("a listed address and a listed range get in", async () => {
    process.env.INTEGRATION_ALLOWED_IPS = "10.1.2.3,172.16.0.0/12,fd00::/8";

    for (const ip of ["10.1.2.3", "172.20.5.5", "fd00::77"])
      assert.equal((await call("GET", "/claims", { ip })).status, 200, ip);

    assert.equal((await call("GET", "/claims", { ip: "10.1.2.4" })).status, 404);
  });

  test("an IPv4 address that arrives written as IPv6 matches the IPv4 rule", async () => {
    process.env.INTEGRATION_ALLOWED_IPS = "10.1.2.3";

    assert.equal((await call("GET", "/claims", { ip: "::ffff:10.1.2.3" })).status, 200);
    assert.equal((await call("GET", "/claims", { ip: "::ffff:10.1.2.4" })).status, 404);
  });

  test("with no list nobody gets in, not even this machine", async () => {
    delete process.env.INTEGRATION_ALLOWED_IPS;

    assert.equal((await call("GET", "/claims")).status, 404, "the socket's own 127.0.0.1");
    assert.equal((await call("GET", "/claims", { ip: "10.1.2.3" })).status, 404);
  });

  test("a list takes this machine out unless it is on it", async () => {
    process.env.INTEGRATION_ALLOWED_IPS = "10.1.2.3";

    assert.equal((await call("GET", "/claims")).status, 404);

    process.env.INTEGRATION_ALLOWED_IPS = "10.1.2.3,127.0.0.1";
    assert.equal((await call("GET", "/claims")).status, 200);
  });

  test("is looked at before HTTPS: a source that may not see the API is not told it needs HTTPS", async () => {
    process.env.INTEGRATION_ALLOWED_IPS = "10.1.2.0/24";
    httpsOn = true;

    assert.equal((await call("GET", "/claims", { ip: "192.168.9.9" })).status, 404);
    assert.equal((await call("GET", "/claims", { ip: "10.1.2.3", https: false })).status, 403);
  });

  test("is looked at before the key: a source that may not see the API is not told about keys", async () => {
    process.env.INTEGRATION_ALLOWED_IPS = "10.1.2.0/24";

    assert.equal((await call("GET", "/claims", { key: "wrong", ip: "192.168.9.9" })).status, 404);
    assert.equal((await call("GET", "/claims", { key: "wrong", ip: "10.1.2.3" })).status, 401);
  });

  test("an unlisted source cannot spend a listed one's failed attempts, or its own", async () => {
    process.env.INTEGRATION_ALLOWED_IPS = "10.1.2.0/24";

    for (let count = 0; count < 30; count++) await call("GET", "/claims", { key: "wrong", ip: "192.168.9.9" });

    assert.equal((await call("GET", "/claims", { key: "wrong", ip: "192.168.9.9" })).status, 404, "still 404, never 429");
    assert.equal((await call("GET", "/claims", { ip: "10.1.2.3" })).status, 200);
  });
});

describe("HTTPS", () => {
  useClaimStore();
  useKeys();

  const REFUSAL = { success: false, message: "HTTPS is required." };

  test("when required, plain HTTP is 403 with its own sentence, key or no key", async () => {
    httpsOn = true;

    for (const key of [KEY, null, "wrong"]) {
      const { status, json } = await call("GET", "/claims", { key });

      assert.equal(status, 403, String(key));
      assert.deepEqual(json, REFUSAL);
    }
  });

  test("when required, a call that came over HTTPS goes through", async () => {
    httpsOn = true;

    assert.equal((await call("GET", "/claims", { https: true })).status, 200);
    assert.equal((await call("POST", "/claims/30/transfer", { https: true, body: { status: "SENT", reference: "R" } })).status, 404);
  });

  test("when not required, plain HTTP is fine", async () => {
    httpsOn = false;

    assert.equal((await call("GET", "/claims")).status, 200);
  });

  test("every route is covered", async () => {
    httpsOn = true;

    for (const [method, path] of [
      ["GET", "/claims"],
      ["GET", "/claims/30"],
      ["GET", "/claims/30/documents/55"],
      ["POST", "/claims/30/transfer"],
    ])
      assert.equal((await call(method, path, { body: method === "POST" ? { status: "SENT", reference: "R" } : undefined })).status, 403, path);
  });

  test("is looked at before the key and before the failed-attempt count", async () => {
    httpsOn = true;

    for (let count = 0; count < 30; count++) await call("GET", "/claims", { key: "wrong" });

    // Thirty refused calls, none a failed authentication: the source is not locked out.
    httpsOn = false;
    assert.equal((await call("GET", "/claims")).status, 200);
  });

  test("a refused call is logged, so a caller that forgot HTTPS can be found", async () => {
    httpsOn = true;
    await call("GET", "/claims");
    await new Promise((resolve) => setImmediate(resolve));

    assert.match(lines[0], /Integration call: unknown key 10\.1\.2\.3 GET .*\/claims 403$/);
  });
});

describe("keys with scopes and an expiry", () => {
  useClaimStore();
  useKeys();

  test("a key that can read cannot report: 403, and nothing is recorded", async () => {
    approved("30");

    const { status, json } = await call("POST", "/claims/30/transfer", { key: OTHER_KEY, body: { status: "SENT", reference: "R" } });

    assert.equal(status, 403);
    assert.equal(json.success, false);
    assert.match(json.message, /claims:transfer/);
    assert.equal(getTransfer("30").status, "QUEUED");
  });

  test("a key that can report cannot read, on any of the three reads", async () => {
    process.env.INTEGRATION_API_KEY_HASHES = entry("reporter", KEY, { scopes: "claims:transfer" });
    approved("30");

    for (const path of ["/claims", "/claims/30", "/claims/30/documents/55"]) {
      const { status, json } = await call("GET", path);

      assert.equal(status, 403, path);
      assert.match(json.message, /claims:read/);
    }

    assert.equal((await call("POST", "/claims/30/transfer", { body: { status: "SENT", reference: "R" } })).status, 200);
  });

  test("a key with both scopes does both", async () => {
    approved("30");

    assert.equal((await call("GET", "/claims/30")).status, 200);
    assert.equal((await call("POST", "/claims/30/transfer", { body: { status: "SENT", reference: "R" } })).status, 200);
  });

  test("a scope refusal is not a failed authentication: it does not count towards the lockout", async () => {
    for (let count = 0; count < 30; count++)
      assert.equal((await call("POST", "/claims/30/transfer", { key: OTHER_KEY, body: { status: "SENT", reference: "R" } })).status, 403);

    assert.equal((await call("GET", "/claims")).status, 200);
  });

  test("an expired key is 401, the same answer as an unknown key", async () => {
    process.env.INTEGRATION_API_KEY_HASHES = setting(entry("old", OTHER_KEY, { expires: "2020-01-01" }), entry("claimsweb", KEY));

    const expired = await call("GET", "/claims", { key: OTHER_KEY });
    const unknown = await call("GET", "/claims", { key: "claims-web-test-key-9999" });

    assert.equal(expired.status, 401);
    assert.deepEqual(expired.json, unknown.json);
    assert.equal((await call("GET", "/claims")).status, 200, "the other key still works");
  });

  test("two entries with one name work together, and the old one can then go", async () => {
    process.env.INTEGRATION_API_KEY_HASHES = setting(entry("claimsweb", KEY), entry("claimsweb", OTHER_KEY));

    assert.equal((await call("GET", "/claims", { key: KEY })).status, 200);
    assert.equal((await call("GET", "/claims", { key: OTHER_KEY })).status, 200);

    process.env.INTEGRATION_API_KEY_HASHES = entry("claimsweb", OTHER_KEY);
    assert.equal((await call("GET", "/claims", { key: KEY })).status, 401);
    assert.equal((await call("GET", "/claims", { key: OTHER_KEY })).status, 200);
  });

  test("the old two-part form no longer opens anything", async () => {
    process.env.INTEGRATION_API_KEY_HASHES = `claimsweb:${sha256(KEY)}`;

    assert.equal((await call("GET", "/claims")).status, 401);
  });
});

describe("failed authentications from one source", () => {
  useClaimStore();
  useKeys();

  const failMany = async (count, ip) => {
    for (let index = 0; index < count; index++) assert.equal((await call("GET", "/claims", { key: "wrong", ip })).status, 401);
  };

  test("twenty failures are answered 401 and the next call from the source is 429", async () => {
    await failMany(20);
    const locked = await call("GET", "/claims", { key: "wrong" });

    assert.equal(locked.status, 429);
    assert.equal(locked.json.success, false);
    assert.ok(Number(locked.headers.get("retry-after")) > 0);
  });

  test("a locked-out source gets 429 even with a good key, on every route", async () => {
    await failMany(20);

    for (const [method, path] of [
      ["GET", "/claims"],
      ["GET", "/claims/30"],
      ["GET", "/claims/30/documents/55"],
      ["POST", "/claims/30/transfer"],
    ])
      assert.equal((await call(method, path, { body: method === "POST" ? { status: "SENT", reference: "R" } : undefined })).status, 429, path);
  });

  test("successful calls do not count", async () => {
    for (let count = 0; count < 60; count++) assert.equal((await call("GET", "/claims")).status, 200);

    await failMany(20);
    assert.equal((await call("GET", "/claims")).status, 429);
  });

  test("calls that fail for another reason do not count: 404, 400, 403", async () => {
    for (let count = 0; count < 25; count++) {
      assert.equal((await call("GET", "/claims/77")).status, 404);
      assert.equal((await call("GET", "/claims?limit=0")).status, 400);
      assert.equal((await call("POST", "/claims/30/transfer", { key: OTHER_KEY, body: {} })).status, 403);
    }

    assert.equal((await call("GET", "/claims")).status, 200);
  });

  test("another source is not locked out", async () => {
    process.env.INTEGRATION_ALLOWED_IPS = "10.1.2.0/24";
    await failMany(20, "10.1.2.3");

    assert.equal((await call("GET", "/claims", { ip: "10.1.2.3" })).status, 429);
    assert.equal((await call("GET", "/claims", { ip: "10.1.2.4" })).status, 200);
  });

  test("the same address in its IPv6 form is the same source", async () => {
    process.env.INTEGRATION_ALLOWED_IPS = "10.1.2.0/24";
    await failMany(10, "10.1.2.3");
    await failMany(10, "::ffff:10.1.2.3");

    assert.equal((await call("GET", "/claims", { ip: "10.1.2.3" })).status, 429);
  });

  test("an expired key is a failed authentication like any other", async () => {
    process.env.INTEGRATION_API_KEY_HASHES = entry("old", KEY, { expires: "2020-01-01" });

    for (let count = 0; count < 20; count++) assert.equal((await call("GET", "/claims")).status, 401);
    assert.equal((await call("GET", "/claims")).status, 429);
  });

  test("the lockout is logged like any call", async () => {
    await failMany(20);
    await call("GET", "/claims");
    await new Promise((resolve) => setImmediate(resolve));

    assert.match(lines.at(-1), /Integration call: unknown key 127\.0\.0\.1 GET .*\/claims 429$/);
  });
});

describe("what every answer carries", () => {
  useClaimStore();
  useKeys();

  const noStore = (headers, label) => {
    assert.equal(headers.get("cache-control"), "no-store", `${label}: Cache-Control`);
    assert.equal(headers.get("pragma"), "no-cache", `${label}: Pragma`);
  };

  test("a success", async () => {
    approved("30");

    for (const path of ["/claims", "/claims/30", "/claims/30/documents/55"]) noStore((await call("GET", path)).headers, path);
    noStore((await call("POST", "/claims/30/transfer", { body: { status: "SENT", reference: "R" } })).headers, "report");
  });

  test("an error of every kind the API gives", async () => {
    approved("30");
    httpsOn = true;
    noStore((await call("GET", "/claims")).headers, "403 https");
    httpsOn = false;

    noStore((await call("GET", "/claims", { key: null })).headers, "401 no key");
    noStore((await call("GET", "/claims", { key: "wrong" })).headers, "401 wrong key");
    noStore((await call("POST", "/claims/30/transfer", { key: OTHER_KEY, body: { status: "SENT", reference: "R" } })).headers, "403 scope");
    noStore((await call("GET", "/claims?limit=0")).headers, "400");
    noStore((await call("GET", "/claims/77")).headers, "404 claim");
    noStore((await call("GET", "/claims/abc")).headers, "404 id");
    noStore((await call("GET", "/claims/30/documents/999")).headers, "404 document");
    noStore((await call("POST", "/claims/30/transfer", { body: {} })).headers, "400 report");

    await call("POST", "/claims/30/transfer", { body: { status: "SENT", reference: "R" } });
    noStore((await call("POST", "/claims/30/transfer", { body: { status: "SENT", reference: "OTHER" } })).headers, "409");

    for (let count = 0; count < 20; count++) await call("GET", "/claims", { key: "wrong" });
    noStore((await call("GET", "/claims")).headers, "429 failed attempts");
  });

  test("and the 404 of a source that may not see the API carries neither, as a missing path has none", async () => {
    process.env.INTEGRATION_ALLOWED_IPS = "10.1.2.0/24";

    const { headers } = await call("GET", "/claims", { ip: "192.168.9.9" });

    assert.equal(headers.get("cache-control"), null);
    assert.equal(headers.get("pragma"), null);
  });
});

describe("the order of the layers", () => {
  useClaimStore();
  useKeys();

  // Each test sets up a request that fails at several layers, and reads which one answered.
  const lockOut = async (ip) => {
    for (let count = 0; count < 20; count++) await call("GET", "/claims", { key: "wrong", ip });
  };

  test("the switch comes first: everything wrong at once is still the 404 of an API that is off", async () => {
    delete process.env.CLAIM_DETAILS_DEV_STORE;
    process.env.INTEGRATION_ALLOWED_IPS = "10.1.2.0/24";
    httpsOn = true;

    assert.equal((await call("GET", "/claims", { key: "wrong", ip: "192.168.9.9" })).status, 404);
  });

  test("then the source: not listed beats a plain HTTP call, a lockout and a wrong key", async () => {
    process.env.INTEGRATION_ALLOWED_IPS = "10.1.2.0/24";
    httpsOn = true;

    assert.equal((await call("GET", "/claims", { key: "wrong", ip: "192.168.9.9" })).status, 404);
  });

  test("then HTTPS: plain HTTP beats a lockout and a wrong key", async () => {
    await lockOut("10.1.2.3");

    assert.equal((await call("GET", "/claims", { key: "wrong", ip: "10.1.2.3", https: false })).status, 403);
    assert.equal((await call("GET", "/claims", { key: "wrong", ip: "10.1.2.3" })).status, 429, "over HTTPS the lockout is next");
  });

  test("then the lockout: it beats the key, a good one or a wrong one", async () => {
    await lockOut();

    assert.equal((await call("GET", "/claims", { key: "wrong" })).status, 429);
    assert.equal((await call("GET", "/claims")).status, 429);
    assert.equal((await call("POST", "/claims/30/transfer", { key: OTHER_KEY, body: {} })).status, 429, "and the scope");
  });

  test("then the key: an unknown key to a route is 401, whatever scope the route needs", async () => {
    assert.equal((await call("POST", "/claims/30/transfer", { key: "wrong", body: { status: "SENT", reference: "R" } })).status, 401);
  });

  test("then the scope: a key without it is 403 even when its own limit is spent", async () => {
    for (let count = 0; count < 120; count++) await call("GET", "/claims", { key: OTHER_KEY });

    assert.equal((await call("GET", "/claims", { key: OTHER_KEY })).status, 429, "its reads are spent");
    assert.equal((await call("POST", "/claims/30/transfer", { key: OTHER_KEY, body: { status: "SENT", reference: "R" } })).status, 403);
  });

  test("then the key's own limit, before the id and the body are looked at", async () => {
    for (let count = 0; count < 120; count++) await call("GET", "/claims");

    assert.equal((await call("GET", "/claims/abc")).status, 429);
    assert.equal((await call("POST", "/claims/30/transfer", { body: {} })).status, 429);
  });
});
