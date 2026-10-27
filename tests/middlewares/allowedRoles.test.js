import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { allowedRoles } from "../../src/middlewares/allowedRoles.js";
import { ADMIN, EMPLOYEE, SUPER_ADMIN } from "../../src/utils/constants.js";
import { makeNext, makeReq, makeRes } from "../helpers/http.js";

const run = (middleware, user) => {
  const next = makeNext();
  middleware(makeReq({ user }), makeRes(), next);
  return next;
};

describe("allowedRoles", () => {
  test("lets an allowed role through", () => {
    const middleware = allowedRoles(ADMIN, SUPER_ADMIN);

    assert.ok(run(middleware, { role_name: ADMIN }).passed());
    assert.ok(run(middleware, { role_name: SUPER_ADMIN }).passed());
  });

  test("401 when there is no user on the request", () => {
    // Distinct from 403 on purpose: nothing proved who is calling, which is a
    // different answer from proving it and being refused.
    const refusal = run(allowedRoles(ADMIN), undefined).refusal();

    assert.deepEqual(refusal, { statusCode: 401, message: "Unauthorized" });
  });

  test("403 for a role that is not on the list", () => {
    const refusal = run(allowedRoles(ADMIN), { role_name: EMPLOYEE }).refusal();

    assert.deepEqual(refusal, { statusCode: 403, message: "Access Denied!" });
  });

  test("HR-only routes refuse an Administrator", () => {
    // The invitation endpoints are the only HR lists that do this, and the
    // asymmetry is deliberate enough to be worth pinning: if it ever changes,
    // it should change because somebody decided to.
    const refusal = run(allowedRoles(ADMIN), { role_name: SUPER_ADMIN }).refusal();

    assert.equal(refusal.statusCode, 403);
  });

  test("the role names are the strings the database uses", () => {
    // 'HR' and 'Administrator', not 'admin' or 'super'. A rename in
    // sec.us02_roles without a matching change here locks everybody out.
    assert.equal(ADMIN, "HR");
    assert.equal(SUPER_ADMIN, "Administrator");
    assert.equal(EMPLOYEE, "Employee");
  });
});
