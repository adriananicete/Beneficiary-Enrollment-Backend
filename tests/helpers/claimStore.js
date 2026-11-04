// Switches the claim details dev store on for a describe block, with a file of its own in a
// temporary folder, and puts the environment back afterwards. It shares the Group Credit Life
// store's file (src/gcli/devStore.js), so this is the same isolation tests/helpers/gcliStore.js
// gives: the file is read again for every test, and none sees another's data. The Group Credit
// Life switch itself is left off.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach } from "node:test";
import { forgetStore } from "../../src/gcli/devStore.js";

const NAMES = ["CLAIM_DETAILS_DEV_STORE", "GCLI_DEV_STORE_FILE", "INTEGRATION_API_KEY_HASHES", "INTEGRATION_ALLOWED_IPS"];

export const useClaimStore = ({ on = true } = {}) => {
  const state = { dir: null, file: null, saved: {} };

  beforeEach(() => {
    state.dir = fs.mkdtempSync(path.join(os.tmpdir(), "claim-details-"));
    state.file = path.join(state.dir, "store.json");
    for (const name of NAMES) state.saved[name] = process.env[name];

    if (on) process.env.CLAIM_DETAILS_DEV_STORE = "true";
    else delete process.env.CLAIM_DETAILS_DEV_STORE;
    process.env.GCLI_DEV_STORE_FILE = state.file;
    forgetStore();
  });

  afterEach(() => {
    for (const name of NAMES) {
      if (state.saved[name] === undefined) delete process.env[name];
      else process.env[name] = state.saved[name];
    }
    forgetStore();
    // Windows can still be letting go of the file just written (a virus scanner, the indexer), and
    // answers ENOTEMPTY or EPERM for a moment: rmSync tries again.
    fs.rmSync(state.dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  });

  return state;
};

export default { useClaimStore };
