import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { assertDevStoreAllowed, devStoreOn, forgetStore, readStore, update } from "../../src/gcli/devStore.js";
import { useDevStore } from "../helpers/gcliStore.js";

const withEnv = (changes, run) => {
  const saved = Object.fromEntries(Object.keys(changes).map((name) => [name, process.env[name]]));
  for (const [name, value] of Object.entries(changes)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    return run();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
};

describe("the switch", () => {
  test("is off unless GCLI_DEV_STORE is exactly true", () => {
    for (const value of [undefined, "", "false", "1", "TRUE", "yes"])
      assert.equal(withEnv({ GCLI_DEV_STORE: value, NODE_ENV: "development" }, devStoreOn), false, String(value));
    assert.equal(withEnv({ GCLI_DEV_STORE: "true", NODE_ENV: "development" }, devStoreOn), true);
  });

  test("is never on in production, and the server refuses to start with it set there", () => {
    assert.equal(withEnv({ GCLI_DEV_STORE: "true", NODE_ENV: "production" }, devStoreOn), false);
    assert.throws(
      () => withEnv({ GCLI_DEV_STORE: "true", NODE_ENV: "production" }, assertDevStoreAllowed),
      /development only/,
    );
    assert.doesNotThrow(() => withEnv({ GCLI_DEV_STORE: "true", NODE_ENV: "development" }, assertDevStoreAllowed));
    assert.doesNotThrow(() => withEnv({ GCLI_DEV_STORE: undefined, NODE_ENV: "production" }, assertDevStoreAllowed));
  });
});

describe("the store", () => {
  const store = useDevStore();

  test("starts empty when there is no file, and writes none until something changes", () => {
    assert.deepEqual(readStore(), { lastApplication: 0, companies: {}, applications: [] });
    assert.equal(fs.existsSync(store.file), false);
  });

  test("a change is written whole, and read back after a restart", () => {
    update((draft) => {
      draft.lastApplication = 3;
      draft.companies["7"] = { plan_code: "GCLIP" };
    });

    assert.ok(fs.existsSync(store.file));
    assert.equal(fs.existsSync(`${store.file}.tmp`), false, "no half-written file left behind");

    forgetStore();
    assert.equal(readStore().lastApplication, 3);
    assert.equal(readStore().companies["7"].plan_code, "GCLIP");
  });

  test("a change that throws leaves the store, in memory and in the file, as it was", () => {
    update((draft) => {
      draft.lastApplication = 1;
    });

    assert.throws(
      () =>
        update((draft) => {
          draft.lastApplication = 99;
          throw new Error("refused");
        }),
      /refused/,
    );

    assert.equal(readStore().lastApplication, 1);
    forgetStore();
    assert.equal(readStore().lastApplication, 1);
  });

  test("a file changed by hand while the server runs is read again, not overwritten from memory", () => {
    update((draft) => {
      draft.lastApplication = 5;
    });

    const edited = JSON.parse(fs.readFileSync(store.file, "utf8"));
    edited.lastApplication = 40;
    fs.writeFileSync(store.file, JSON.stringify(edited));
    // the change is a later moment than the server's own write
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(store.file, later, later);

    assert.equal(readStore().lastApplication, 40);
    update((draft) => {
      draft.lastApplication += 1;
    });
    assert.equal(JSON.parse(fs.readFileSync(store.file, "utf8")).lastApplication, 41);
  });

  test("a file deleted while the server runs starts the store again", () => {
    update((draft) => {
      draft.lastApplication = 5;
    });
    fs.rmSync(store.file);

    assert.equal(readStore().lastApplication, 0);
  });

  test("a file that is not JSON is reported, not replaced", () => {
    fs.writeFileSync(store.file, "{ not json");
    assert.throws(() => readStore(), /not valid JSON/);
    assert.equal(fs.readFileSync(store.file, "utf8"), "{ not json");
  });
});
