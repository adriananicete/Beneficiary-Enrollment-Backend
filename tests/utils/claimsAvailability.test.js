import test from "node:test";
import assert from "node:assert/strict";
import { claimsEnabled, isClaimsBlocked, isClaimsPath } from "../../src/utils/claimsAvailability.js";

const original = process.env.CLAIMS_ENABLED;

test.afterEach(() => {
  if (original === undefined) delete process.env.CLAIMS_ENABLED;
  else process.env.CLAIMS_ENABLED = original;
});

test("a claims path is any path with a claims segment", () => {
  for (const path of ["/claims", "/claims/7/documents/3", "/claim-types", "/enrollments/5/death-claim", "/Claims/pending-count"]) {
    assert.equal(isClaimsPath(path), true, path);
  }
  for (const path of ["/enrollments", "/messages/claims-note", "/me"]) assert.equal(isClaimsPath(path), false, path);
});

test("claims are blocked unless CLAIMS_ENABLED is true", () => {
  delete process.env.CLAIMS_ENABLED;
  assert.equal(claimsEnabled(), false);
  assert.equal(isClaimsBlocked("/claims"), true);

  for (const value of ["false", "1", "yes", ""]) {
    process.env.CLAIMS_ENABLED = value;
    assert.equal(isClaimsBlocked("/claims"), true, value);
  }

  process.env.CLAIMS_ENABLED = " TRUE ";
  assert.equal(claimsEnabled(), true);
  assert.equal(isClaimsBlocked("/claims"), false);
  assert.equal(isClaimsBlocked("/enrollments"), false);
});
