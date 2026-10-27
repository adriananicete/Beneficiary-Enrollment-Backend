import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";

// env.js reads process.env once at import and throws on a bad value, so each
// case needs its own module instance. A cache-busting query string on the
// specifier is what gives one.
const loadEnv = async (overrides) => {
  const saved = { ...process.env };

  // The shared helper sets APP_URL and CORS_ORIGIN to localhost, and env.js
  // refuses those in production — the PR #85 guard, which fires after this one
  // and is not what these tests are about. Given real-looking values so the
  // production cases reach the TRUST_PROXY rules instead of stopping short.
  if (overrides.NODE_ENV === "production") {
    process.env.APP_URL = "https://enroll.example.com";
    process.env.CORS_ORIGIN = "https://enroll.example.com";
  }

  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  try {
    const module = await import(
      `../../src/config/env.js?trustProxy=${Math.random()}`
    );
    return module.default;
  } finally {
    process.env = saved;
  }
};

const expectRefusal = async (overrides, pattern) => {
  await assert.rejects(() => loadEnv(overrides), pattern);
};

describe("TRUST_PROXY — what req.ip is allowed to mean", () => {
  test("a hop count is accepted", async () => {
    const config = await loadEnv({ TRUST_PROXY: "1", NODE_ENV: "production" });

    assert.equal(config.trustProxy, 1);
  });

  test("false is accepted, and is not the string", async () => {
    const config = await loadEnv({ TRUST_PROXY: "false", NODE_ENV: "production" });

    assert.equal(config.trustProxy, false);
  });

  test("unset in development still works, and behaves as it always did", async () => {
    // Development must not need a new variable to run. The old hardcoded
    // value was false, so that is what unset resolves to.
    const config = await loadEnv({ TRUST_PROXY: undefined, NODE_ENV: "development" });

    assert.equal(config.trustProxy, false);
  });

  test("unset in PRODUCTION refuses to start", async () => {
    // The whole point. Left unset it would default to no proxy, and if there
    // is one then every consent record stores the proxy's address instead of
    // the employee's — which cannot be recovered after the fact.
    await expectRefusal(
      { TRUST_PROXY: undefined, NODE_ENV: "production" },
      /TRUST_PROXY must be set in production/,
    );
  });

  test("true is refused, in production and in development", async () => {
    // `true` trusts a client-supplied X-Forwarded-For, so any caller could
    // choose the address recorded on their own consent record. Refused
    // everywhere rather than only in production, because a developer who sets
    // it locally will set it in production too.
    for (const nodeEnv of ["production", "development"])
      await expectRefusal(
        { TRUST_PROXY: "true", NODE_ENV: nodeEnv },
        /must not be true/,
      );
  });

  test("the refusal explains what to set instead", async () => {
    // A refusal that does not say what to do next just moves the problem.
    await assert.rejects(
      () => loadEnv({ TRUST_PROXY: "true", NODE_ENV: "production" }),
      (error) => {
        assert.match(error.message, /X-Forwarded-For/);
        assert.match(error.message, /number of proxies/);
        return true;
      },
    );
  });

  test("nonsense is refused rather than coerced", async () => {
    for (const raw of ["yes", "1.5", "-1", "proxy"])
      await expectRefusal(
        { TRUST_PROXY: raw, NODE_ENV: "production" },
        /whole number of proxy hops/,
      );
  });
});
