import { describe, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import "../helpers/env.js";

// env.js reads process.env once at import and throws on a bad value, so each
// case needs its own module instance. The same cache-busting import as
// appUrl.test.js.
const loadEnv = async (overrides) => {
  const saved = { ...process.env };

  // Production refuses these before it reaches anything else, so they are
  // given values that pass.
  if (overrides.NODE_ENV === "production") {
    process.env.TRUST_PROXY = "false";
    process.env.CORS_ORIGIN = "https://enroll.example.com";
    process.env.APP_URL = "https://enroll.example.com";
  }

  for (const [name, value] of Object.entries(overrides)) process.env[name] = value;

  try {
    const module = await import(`../../src/config/env.js?jwtSecret=${Math.random()}`);
    return module.default;
  } finally {
    process.env = saved;
  }
};

// The floor, pinned as a literal.
const THIRTY_ONE = "x".repeat(31);
const THIRTY_TWO = "x".repeat(32);

describe("JWT_SECRET — what signs every session", () => {
  for (const NODE_ENV of ["development", "production"]) {
    test(`31 characters is refused in ${NODE_ENV}`, async () => {
      await assert.rejects(
        () => loadEnv({ JWT_SECRET: THIRTY_ONE, NODE_ENV }),
        /JWT_SECRET must be at least 32 characters; it is 31/,
      );
    });

    test(`32 characters is accepted in ${NODE_ENV}`, async () => {
      const config = await loadEnv({ JWT_SECRET: THIRTY_TWO, NODE_ENV });

      assert.equal(config.jwtSecret, THIRTY_TWO);
    });
  }

  test("the usual placeholders are refused", async () => {
    for (const JWT_SECRET of ["secret", "changeme", "jwt_secret", "mysecretkey123"])
      await assert.rejects(() => loadEnv({ JWT_SECRET, NODE_ENV: "development" }), /at least 32/);
  });

  // The error lands in a log. It may say how long the secret is, never what it is.
  test("the refusal never repeats the secret", async () => {
    const JWT_SECRET = "tooShortButStillASecret";

    await assert.rejects(
      () => loadEnv({ JWT_SECRET, NODE_ENV: "development" }),
      (error) => !error.message.includes(JWT_SECRET),
    );
  });

  // What the error message tells the reader to run, so following it works.
  test("a secret generated the way the error says is accepted", async () => {
    const JWT_SECRET = crypto.randomBytes(48).toString("base64");
    const config = await loadEnv({ JWT_SECRET, NODE_ENV: "production" });

    assert.equal(config.jwtSecret, JWT_SECRET);
  });
});
