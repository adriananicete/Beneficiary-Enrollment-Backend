import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";

import {
  matchDocuments,
  requirementField,
  requirementIdOf,
} from "../../src/utils/claimDocuments.js";
import { parseDocuments } from "../../src/middlewares/parseDocuments.js";
import { errorHandler } from "../../src/middlewares/errorHandler.js";
import { silenceConsoleError } from "../helpers/http.js";

// Which uploaded file answers which requirement, decided 2026-10-12: one
// multipart field per requirement, requirement_<id>, and more than one file
// allowed in a field. Judged before the claim's transaction opens.

// TEST-CLAIM as the DBA seeded it on 2026-10-12. The ids arrive as strings,
// because they are BigInt, and is_required as a boolean, because it is a BIT.
const REQUIREMENTS = [
  { requirement_id: "1", claim_type_id: "1", requirement_desc: "Test document (required)", is_required: true },
  { requirement_id: "2", claim_type_id: "1", requirement_desc: "Test document (optional)", is_required: false },
];

const file = (field, fileName = "scan.pdf") => ({ field, fileName });

const refusal = (fn) => {
  try {
    fn();
  } catch (error) {
    return { statusCode: error.statusCode, message: error.message };
  }
  return null;
};

describe("requirement field names", () => {
  test("a requirement's field is requirement_<id>", () => {
    assert.equal(requirementField("12"), "requirement_12");
    assert.equal(requirementField(12), "requirement_12");
  });

  test("the id is read back as text, and anything else is null", () => {
    assert.equal(requirementIdOf("requirement_12"), "12");

    for (const field of ["requirement_", "requirement_1x", "requirement_-1", "Requirement_1", "requirement_1 ", "doc_1", "", undefined])
      assert.equal(requirementIdOf(field), null, JSON.stringify(field));
  });
});

describe("matchDocuments", () => {
  test("each document comes back with the requirement it answers", () => {
    const matched = matchDocuments(REQUIREMENTS, [file("requirement_1", "a.pdf"), file("requirement_2", "b.jpg")]);

    assert.deepEqual(
      matched.map(({ fileName, requirementId }) => [fileName, requirementId]),
      [["a.pdf", "1"], ["b.jpg", "2"]],
    );
  });

  test("an optional document can be left out", () => {
    assert.equal(matchDocuments(REQUIREMENTS, [file("requirement_1")]).length, 1);
  });

  // A medical record of several pages, scanned one page to a file.
  test("one requirement can carry more than one file", () => {
    const matched = matchDocuments(REQUIREMENTS, [file("requirement_1", "p1.jpg"), file("requirement_1", "p2.jpg")]);

    assert.deepEqual(matched.map((document) => document.requirementId), ["1", "1"]);
  });

  test("a missing required document is 400, and the refusal names it", () => {
    assert.deepEqual(refusal(() => matchDocuments(REQUIREMENTS, [file("requirement_2")])), {
      statusCode: 400,
      message: "Missing required documents: Test document (required)",
    });
  });

  test("every missing required document is named, not only the first", () => {
    const requirements = [
      ...REQUIREMENTS,
      { requirement_id: "3", requirement_desc: "Medical certificate", is_required: true },
    ];

    assert.equal(
      refusal(() => matchDocuments(requirements, [])).message,
      "Missing required documents: Test document (required), Medical certificate",
    );
  });

  // The driver hands a BIT back as a boolean, but a procedure that computes it
  // can hand back an INT. Both mean required.
  test("is_required counts whether it arrives as true or as 1", () => {
    const asNumber = REQUIREMENTS.map((requirement) => ({ ...requirement, is_required: requirement.is_required ? 1 : 0 }));

    assert.equal(refusal(() => matchDocuments(asNumber, [])).statusCode, 400);
    assert.equal(matchDocuments(asNumber, [file("requirement_1")]).length, 1);
  });

  test("a field that is not requirement_<id> is 400, by name", () => {
    assert.deepEqual(refusal(() => matchDocuments(REQUIREMENTS, [file("requirement_1"), file("death_certificate")])), {
      statusCode: 400,
      message: "death_certificate is not a document this claim type asks for",
    });
  });

  // The caller passes only this type's requirements, so another type's id is
  // unknown here, exactly like an id that does not exist.
  test("a requirement of another claim type is 400", () => {
    assert.equal(
      refusal(() => matchDocuments(REQUIREMENTS, [file("requirement_1"), file("requirement_9")])).message,
      "requirement_9 is not a document this claim type asks for",
    );
  });

  test("no documents at all is fine for a type that requires none", () => {
    assert.deepEqual(matchDocuments([REQUIREMENTS[1]], []), []);
  });
});

// A resubmit adds to the documents the claim was filed with.
describe("matchDocuments on a resubmit", () => {
  test("a required document the claim already has counts", () => {
    const matched = matchDocuments(REQUIREMENTS, [file("requirement_2")], ["1"]);

    assert.deepEqual(matched.map((document) => document.requirementId), ["2"]);
  });

  // The ids arrive from the database as strings, but a number must count too.
  test("the existing ids count whether they are text or numbers", () => {
    assert.equal(matchDocuments(REQUIREMENTS, [file("requirement_2")], [1]).length, 1);
  });

  test("a required document neither existing nor sent is still 400", () => {
    assert.equal(
      refusal(() => matchDocuments(REQUIREMENTS, [file("requirement_2")], ["2"])).message,
      "Missing required documents: Test document (required)",
    );
  });

  // What the claim already has does not widen what may be sent.
  test("a field nobody asked for is still refused", () => {
    assert.equal(
      refusal(() => matchDocuments(REQUIREMENTS, [file("requirement_9")], ["1", "9"])).message,
      "requirement_9 is not a document this claim type asks for",
    );
  });
});

// Through a real Express app and real multipart requests, so the field names
// are the ones a browser's FormData actually produces, read by the real
// parseDocuments.
describe("matchDocuments behind parseDocuments", () => {
  let server;
  let base;
  let restoreConsole;

  before(() => {
    restoreConsole = silenceConsoleError();

    const app = express();
    app.post("/claims", parseDocuments, (req, res, next) => {
      try {
        const matched = matchDocuments(REQUIREMENTS, req.documents);

        res.status(200).json({
          claimTypeId: req.body.claim_type_id,
          matched: matched.map(({ fileName, requirementId, mimeType }) => ({ fileName, requirementId, mimeType })),
        });
      } catch (error) {
        next(error);
      }
    });
    app.use(errorHandler);

    server = app.listen(0);
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => {
    server.close();
    restoreConsole();
  });

  const pdf = () => {
    const buffer = Buffer.alloc(64, 0x20);
    Buffer.from("%PDF-1.7").copy(buffer);
    return buffer;
  };

  const post = async (form) => {
    const response = await fetch(`${base}/claims`, { method: "POST", body: form });
    return { status: response.status, body: await response.json() };
  };

  test("a claim as the frontend sends it", async () => {
    const form = new FormData();
    form.append("claim_type_id", "1");
    form.append("requirement_1", new Blob([pdf()]), "page 1.pdf");
    form.append("requirement_1", new Blob([pdf()]), "page 2.pdf");
    form.append("requirement_2", new Blob([pdf()]), "Peña ID.pdf");

    const { status, body } = await post(form);

    assert.equal(status, 200);
    assert.equal(body.claimTypeId, "1");
    assert.deepEqual(body.matched, [
      { fileName: "page 1.pdf", requirementId: "1", mimeType: "application/pdf" },
      { fileName: "page 2.pdf", requirementId: "1", mimeType: "application/pdf" },
      { fileName: "Peña ID.pdf", requirementId: "2", mimeType: "application/pdf" },
    ]);
  });

  test("a claim missing its required document is refused with the reason", async () => {
    const form = new FormData();
    form.append("claim_type_id", "1");
    form.append("requirement_2", new Blob([pdf()]), "id.pdf");

    const { status, body } = await post(form);

    assert.equal(status, 400);
    assert.equal(body.message, "Missing required documents: Test document (required)");
  });
});
