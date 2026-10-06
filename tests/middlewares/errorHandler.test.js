import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import { errorHandler } from "../../src/middlewares/errorHandler.js";
import { AppError } from "../../src/utils/AppError.js";
import { makeNext, makeReq, makeRes, silenceConsoleError } from "../helpers/http.js";

let restoreConsole;

before(() => {
  // errorHandler logs every error it handles, which is correct in production
  // and noise here.
  restoreConsole = silenceConsoleError();
});

after(() => restoreConsole());

const handle = (err) => {
  const res = makeRes();
  errorHandler(err, makeReq(), res, makeNext());
  return res;
};

describe("errorHandler", () => {
  test("an AppError is answered with its own status and message", () => {
    const res = handle(new AppError("Invitation not found", 404));

    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, {
      success: false,
      message: "Invitation not found",
    });
  });

  test("a mapped SQL error becomes its mapped status and message", () => {
    const res = handle({ number: 50007 });

    assert.equal(res.statusCode, 409);
    assert.match(res.body.message, /same name/i);
  });

  test("a SQL number nested one level down is still found", () => {
    // The number arrives at different depths depending on the failure. Missing
    // the nested case is what once turned a non-existent-user login into a 500
    // instead of a 401.
    const res = handle({ originalError: { number: 50007 } });

    assert.equal(res.statusCode, 409);
  });

  test("anything else is exactly 500 Server Error", () => {
    // Nothing internal ever reaches the client. The wording is fixed because
    // the frontend documentation promises this exact string for a 500.
    for (const err of [
      new Error("connect ETIMEDOUT 192.5.5.142"),
      { number: 99999 },
      {},
    ]) {
      const res = handle(err);

      assert.equal(res.statusCode, 500);
      assert.deepEqual(res.body, { success: false, message: "Server Error" });
    }
  });

  test("an unmapped number does not leak the database's own message", () => {
    const res = handle({
      number: 50006,
      message: "enrollment does not exist.",
    });

    assert.equal(res.body.message, "Server Error");
    assert.ok(!res.body.message.includes("enrollment"));
  });

  test("a statusCode wins over a SQL number when both are present", () => {
    const err = new AppError("Forbidden", 403);
    err.number = 50007;

    assert.equal(handle(err).statusCode, 403);
  });

  test("every response carries success: false", () => {
    for (const err of [new AppError("x", 400), { number: 50007 }, new Error("x")]) {
      assert.equal(handle(err).body.success, false);
    }
  });

  // Only AppError speaks for itself. Anything else carrying a status keeps the
  // status, never the message.
  test("a 4xx that is not an AppError keeps its status and loses its message", () => {
    const res = handle({ status: 400, type: "something.unknown", message: "internal detail 12345" });

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.message, "The request could not be read.");
  });

  test("a 5xx from a library is the plain 500", () => {
    const res = handle({ status: 503, message: "stream not readable" });

    assert.equal(res.statusCode, 500);
    assert.equal(res.body.message, "Server Error");
  });
});

// The real libraries, through a real app. A fake error object would only prove
// the shape that was assumed, which is how a test passed today while the real
// procedure threw something else. These are the errors express.json() and the
// router actually raise.
describe("errorHandler — what the libraries raise", () => {
  let server;
  let base;

  before(async () => {
    const { default: express } = await import("express");

    const app = express();
    app.use(express.json({ limit: "1kb" }));
    app.post("/body", (req, res) => res.status(200).json({ reached: true }));
    app.get("/enrollments/:client_id", (req, res) => res.status(200).json({ reached: true }));
    app.use(errorHandler);

    server = app.listen(0);
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => server.close());

  const post = (body, type = "application/json") =>
    fetch(`${base}/body`, { method: "POST", headers: { "Content-Type": type }, body });

  // It used to answer with the parser's message, which quoted the body back.
  test("malformed JSON is 400, in our words, without the body quoted back", async () => {
    const response = await post('{"username": EMP-SECRET-020}');
    const text = await response.text();

    assert.equal(response.status, 400);
    assert.equal(JSON.parse(text).message, "The request body is not valid JSON.");
    assert.ok(!text.includes("EMP-SECRET-020"), text);
  });

  test("a body over the limit is 413", async () => {
    const response = await post(JSON.stringify({ a: "x".repeat(2000) }));

    assert.equal(response.status, 413);
    assert.equal((await response.json()).message, "The request body is too large.");
  });

  test("an unsupported charset is 415, without repeating it", async () => {
    const response = await post('{"a":1}', "application/json; charset=klingon");
    const text = await response.text();

    assert.equal(response.status, 415);
    assert.equal(JSON.parse(text).message, "The request body's encoding is not supported.");
    assert.ok(!/klingon/i.test(text), text);
  });

  // The router sets `status` and not `statusCode`, so this was a 500 for
  // anybody who sent one bad character.
  test("a URL param that does not decode is 400, not 500", async () => {
    const response = await fetch(`${base}/enrollments/%E0%A4%A`);

    assert.equal(response.status, 400);
    assert.equal((await response.json()).message, "The request could not be read.");
  });

  test("an ordinary request is untouched", async () => {
    const response = await post('{"a":1}');

    assert.equal(response.status, 200);
  });
});
