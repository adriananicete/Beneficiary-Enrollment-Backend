import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import "../helpers/env.js";
import { useClaimStore } from "../helpers/claimStore.js";
import { entry, setting } from "../helpers/integrationKeys.js";

const { checkIntegrationAtStart } = await import("../../src/claims/startup.js");

// What the server checks and says at start (server.js calls this). It applies whenever the hand-off
// API is on, in every NODE_ENV: the development store is never on in production, and UAT runs as
// development, so a check that waited for "production" would never run where the API can.

const KEY_ENTRY = entry("claims-web", "claims-web-test-key-0001");

const start = (options = {}) => {
  const said = { log: [], warn: [] };

  const result = checkIntegrationAtStart({
    trustProxy: false,
    ...options,
    log: (line) => said.log.push(line),
    warn: (line) => said.warn.push(line),
  });

  return { result, ...said };
};

const savedNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = savedNodeEnv;
});

describe("with the switch off", () => {
  useClaimStore({ on: false });

  test("it checks nothing and says nothing, whatever the keys and the list are", () => {
    process.env.INTEGRATION_API_KEY_HASHES = "not even valid";
    process.env.INTEGRATION_ALLOWED_IPS = "banana";

    assert.deepEqual(start({ trustProxy: true }), { result: false, log: [], warn: [] });
  });
});

describe("with the switch on", () => {
  useClaimStore();

  test("a key and an allowed address start, and the server says who and what", () => {
    process.env.INTEGRATION_API_KEY_HASHES = KEY_ENTRY;
    process.env.INTEGRATION_ALLOWED_IPS = "10.1.2.3,10.1.4.0/24";

    const { result, log, warn } = start();

    assert.equal(result, true);
    assert.ok(log.some((line) => /^Integration key: claims-web scopes claims:read\+claims:transfer expires 2099-12-31$/.test(line)));
    assert.ok(log.some((line) => /allowed from 2 listed/.test(line)));
    assert.equal(warn.length, 1, "only the warning that the store is a file");
    assert.match(warn[0], /kept in a file/);
  });

  // A key with nowhere to come from: an empty list allows nobody, and is a mistake worth refusing.
  test("a key with no allowed address refuses the start, in every NODE_ENV the API can run in", () => {
    process.env.INTEGRATION_API_KEY_HASHES = KEY_ENTRY;

    for (const nodeEnv of ["development", "test", "staging"]) {
      process.env.NODE_ENV = nodeEnv;

      for (const list of [undefined, "", "  "]) {
        if (list === undefined) delete process.env.INTEGRATION_ALLOWED_IPS;
        else process.env.INTEGRATION_ALLOWED_IPS = list;

        assert.throws(() => start(), /INTEGRATION_ALLOWED_IPS must list/, `\${nodeEnv} \${list}`);
      }
    }
  });

  test("a developer who lists this machine starts", () => {
    process.env.INTEGRATION_API_KEY_HASHES = KEY_ENTRY;
    process.env.INTEGRATION_ALLOWED_IPS = "127.0.0.1,::1";

    assert.equal(start().result, true);
  });

  test("with no key an empty list starts, and the server says nobody can reach it", () => {
    const { result, warn } = start();

    assert.equal(result, true);
    assert.ok(warn.some((line) => /INTEGRATION_API_KEY_HASHES is empty/.test(line)));
    assert.ok(warn.some((line) => /INTEGRATION_ALLOWED_IPS is empty, so nobody can reach/.test(line)));
  });

  test("\"trust proxy\" true refuses the start", () => {
    process.env.INTEGRATION_API_KEY_HASHES = KEY_ENTRY;
    process.env.INTEGRATION_ALLOWED_IPS = "10.1.2.3";

    assert.throws(() => start({ trustProxy: true }), /trust proxy/);
    assert.doesNotThrow(() => start({ trustProxy: 1 }));
  });

  test("a malformed key entry or list entry refuses the start", () => {
    process.env.INTEGRATION_ALLOWED_IPS = "10.1.2.3";
    process.env.INTEGRATION_API_KEY_HASHES = "claims-web:abc";
    assert.throws(() => start(), /INTEGRATION_API_KEY_HASHES entry 1/);

    process.env.INTEGRATION_API_KEY_HASHES = KEY_ENTRY;
    process.env.INTEGRATION_ALLOWED_IPS = "10.1.2.3,banana";
    assert.throws(() => start(), /INTEGRATION_ALLOWED_IPS entry 2/);
  });

  test("a key that expires soon, or has expired, is warned about", () => {
    const soon = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    process.env.INTEGRATION_ALLOWED_IPS = "10.1.2.3";
    process.env.INTEGRATION_API_KEY_HASHES = setting(
      entry("soon", "claims-web-test-key-0002", { expires: soon }),
      entry("old", "claims-web-test-key-0003", { expires: "2020-01-01" }),
      entry("far", "claims-web-test-key-0004"),
    );

    const { warn } = start();

    assert.ok(warn.some((line) => /key soon expires in \d+ day/.test(line)));
    assert.ok(warn.some((line) => /key old expired on 2020-01-01/.test(line)));
    assert.ok(!warn.some((line) => /key far/.test(line)));
  });

  test("a switch on in production refuses the start before anything else", () => {
    process.env.NODE_ENV = "production";

    assert.throws(() => start(), /development only/);
  });
});

describe("server.js", () => {
  // server.js opens the database, so a test cannot start it; this keeps the call from being lost.
  test("makes the check before the hand-off API is mounted", () => {
    const source = fs.readFileSync(new URL("../../server.js", import.meta.url), "utf8");

    const check = source.indexOf("checkIntegrationAtStart({ trustProxy: app.get('trust proxy') })");
    const mount = source.indexOf("/integration`");

    assert.ok(check > 0, "server.js calls checkIntegrationAtStart with the trust proxy setting");
    assert.ok(mount > check, "and does so before it mounts the integration routes");
  });
});
