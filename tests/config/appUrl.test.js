import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../helpers/env.js";

// env.js reads process.env once at import and throws on a bad value, so each
// case needs its own module instance. A cache-busting query string on the
// specifier is what gives one.
const loadEnv = async (overrides) => {
  const saved = { ...process.env };

  // Production refuses an unset TRUST_PROXY and a localhost CORS_ORIGIN before
  // it reaches APP_URL. Given real-looking values so the production cases get
  // as far as the rules these tests are about.
  if (overrides.NODE_ENV === "production") {
    process.env.TRUST_PROXY = "false";
    process.env.CORS_ORIGIN = "https://enroll.example.com";
  }

  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  try {
    const module = await import(
      `../../src/config/env.js?appUrl=${Math.random()}`
    );
    return module.default;
  } finally {
    process.env = saved;
  }
};

const appUrlFor = async (APP_URL, NODE_ENV = "development") =>
  (await loadEnv({ APP_URL, NODE_ENV })).appUrl;

const expectRefusal = async (APP_URL, NODE_ENV, pattern) => {
  await assert.rejects(() => loadEnv({ APP_URL, NODE_ENV }), pattern);
};

describe("APP_URL — the base of every link in every email", () => {
  test("the UAT value, with no scheme, refuses to start and says what was meant", async () => {
    // The value that reached UAT on 2026-09-23. Every email went out; Outlook
    // repaired the link and Gmail removed it. Refused in development, because
    // UAT runs as development.
    await assert.rejects(
      () => loadEnv({ APP_URL: "192.5.5.122:82", NODE_ENV: "development" }),
      (error) => {
        assert.match(error.message, /must be a complete address/);
        assert.match(error.message, /did you mean "http:\/\/192\.5\.5\.122:82"/);
        return true;
      },
    );
  });

  test("a host with a port and no scheme is refused, though new URL() accepts it", async () => {
    // `new URL("localhost:5173")` parses, with the protocol "localhost:". It
    // is the protocol check that refuses this, not the parse.
    await expectRefusal("localhost:5173", "development", /must start with http:\/\/ or https:\/\//);
  });

  test("a scheme other than http or https is refused", async () => {
    await expectRefusal("ftp://enroll.example.com", "development", /must start with http:\/\/ or https:\/\//);
  });

  test("http is accepted outside production", async () => {
    assert.equal(await appUrlFor("http://192.5.5.122:82"), "http://192.5.5.122:82");
  });

  test("http is refused in production, and https is accepted", async () => {
    await expectRefusal("http://enroll.example.com", "production", /must use https:\/\/ in production/);

    assert.equal(
      await appUrlFor("https://enroll.example.com", "production"),
      "https://enroll.example.com",
    );
  });

  test("a trailing slash is removed rather than refused", async () => {
    // Kept, it would build `http://192.5.5.122:82//employee-login`.
    assert.equal(await appUrlFor("http://192.5.5.122:82/"), "http://192.5.5.122:82");
    assert.equal(await appUrlFor("https://enroll.example.com/enroll/"), "https://enroll.example.com/enroll");
    assert.equal(await appUrlFor("http://enroll.example.com//"), "http://enroll.example.com");
  });

  test("the login link built from it has exactly one slash", async () => {
    // The shape emailService.js and enrollmentService.js build.
    const appUrl = await appUrlFor("http://192.5.5.122:82/");

    assert.equal(`${appUrl}/employee-login`, "http://192.5.5.122:82/employee-login");
  });

  test("a query string or fragment is refused, even an empty one", async () => {
    // A bare `?` or `#` parses to an empty search and hash, so the raw text is
    // what has to be tested. Any of these would turn "?token=…" into a second
    // query string or a fragment.
    for (const value of [
      "http://enroll.example.com?ref=1",
      "http://enroll.example.com#top",
      "http://enroll.example.com?",
      "http://enroll.example.com#",
    ])
      await expectRefusal(value, "development", /must not contain \? or #/);
  });
});
