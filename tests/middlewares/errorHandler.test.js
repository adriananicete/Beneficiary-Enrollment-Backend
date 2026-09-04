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
});
