// Switches the Group Credit Life dev store on for a describe block, with a file of its
// own in a temporary folder, and puts the environment back afterwards. The store is
// read from the file again for every test, so none sees another's data.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach } from "node:test";
import { forgetStore } from "../../src/gcli/devStore.js";

const NAMES = ["GCLI_DEV_STORE", "GCLI_DEV_STORE_FILE"];

export const useDevStore = () => {
  const state = { dir: null, file: null, saved: {} };

  beforeEach(() => {
    state.dir = fs.mkdtempSync(path.join(os.tmpdir(), "gcli-"));
    state.file = path.join(state.dir, "store.json");
    for (const name of NAMES) state.saved[name] = process.env[name];

    process.env.GCLI_DEV_STORE = "true";
    process.env.GCLI_DEV_STORE_FILE = state.file;
    forgetStore();
  });

  afterEach(() => {
    for (const name of NAMES) {
      if (state.saved[name] === undefined) delete process.env[name];
      else process.env[name] = state.saved[name];
    }
    forgetStore();
    fs.rmSync(state.dir, { recursive: true, force: true });
  });

  return state;
};

export const LIMITS = {
  min_loan: 50000,
  max_loan: 5000000,
  max_term_months: 60,
  min_entry_age: 18,
  max_entry_age: 65,
  max_maturity_age: 70,
  no_medical_limit: 1000000,
};

export const CREDIT_PLAN = {
  plan_code: "GCLIP",
  plan_desc: "Group Credit Life Insurance Plan",
  plan_template: "G-CLI",
};

export default { useDevStore, LIMITS, CREDIT_PLAN };
