import { describe, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";

import { developmentOnly } from "../../src/middlewares/developmentOnly.js";
import { makeNext, makeReq, makeRes } from "../helpers/http.js";

// The development wipe's door (DBA request 26). In production the route must
// answer exactly as a path that was never declared: next("router") leaves the
// router, and Express ends in its own 404.
const run = (nodeEnv) => {
  const next = makeNext();
  developmentOnly(nodeEnv)(makeReq(), makeRes(), next);
  return next;
};

describe("developmentOnly", () => {
  test("in production it leaves the router, with no error to report", () => {
    assert.deepEqual(run("production").calls, ["router"]);
  });

  // UAT runs as development, so the wipe is there too (decided 2026-10-15).
  test("anywhere else it lets the request through", () => {
    for (const nodeEnv of ["development", "test", undefined, "staging"])
      assert.ok(run(nodeEnv).passed(), String(nodeEnv));
  });

  // Exact, not "contains": PRODUCTION or prod are not production to config,
  // and a looser match here would disagree with every other production check.
  test("only the exact value production closes it", () => {
    assert.ok(run("Production").passed());
    assert.ok(run("prod").passed());
  });
});

// What next("router") does is Express's, so it is proven through Express: a
// real router, a real request. In production the wipe's path must answer
// exactly as a path nobody declared, and the session check behind the door
// must never run.
describe("developmentOnly — through Express", () => {
  const serve = async (nodeEnv) => {
    let sessionChecked = false;

    const router = express.Router();
    router.post(
      "/enrollments/wipe",
      developmentOnly(nodeEnv),
      (req, res, next) => {
        sessionChecked = true;
        next();
      },
      (req, res) => res.status(200).json({ reached: true }),
    );

    const app = express();
    app.use("/api/v1/admin", router);

    const server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const base = `http://127.0.0.1:${server.address().port}/api/v1/admin`;

    const answer = async (path) => {
      const res = await fetch(`${base}${path}`, { method: "POST" });
      return { status: res.status, body: (await res.text()).replace(path, "<path>") };
    };

    try {
      return {
        wipe: await answer("/enrollments/wipe"),
        undeclared: await answer("/enrollments/nothing-here"),
        sessionChecked: () => sessionChecked,
      };
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  };

  test("in production the path answers exactly as an undeclared one, and nothing behind the door runs", async () => {
    const { wipe, undeclared, sessionChecked } = await serve("production");

    assert.equal(wipe.status, 404);
    assert.deepEqual(wipe, undeclared);
    assert.equal(sessionChecked(), false);
  });

  test("anywhere else the request reaches the route", async () => {
    const { wipe, sessionChecked } = await serve("development");

    assert.equal(wipe.status, 200);
    assert.equal(sessionChecked(), true);
  });
});
