import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  MAX_DETAILS_CHARS,
  checkDetails,
  parseDetails,
  validateDetails,
} from "../../src/claims/detailsSchema.js";

// The shared cases (docs/claims-details/CONTRACT.md, "Shared cases"). The frontend runs the same
// file through its own validator, and both must agree on every case. docs/ is not tracked, so the
// file is kept here as a fixture; the last test says so if the two copies drift.
const FIXTURE = new URL("../fixtures/claim-details-cases.json", import.meta.url);
const SOURCE = new URL("../../docs/claims-details/cases.json", import.meta.url);

const shared = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
const context = { today: shared.context.today, birthdate: shared.context.birthdate };

// {"$repeat": ["x", 201]} is the text "x" 201 times.
const valueOf = (value) =>
  value && typeof value === "object" && "$repeat" in value
    ? value.$repeat[0].repeat(value.$repeat[1])
    : value;

const setPath = (object, dotted, value) => {
  const keys = dotted.split(".");
  const last = keys.pop();
  let target = object;

  for (const key of keys) target = target[key];
  target[last] = value;
};

const removePath = (object, dotted) => {
  const keys = dotted.split(".");
  const last = keys.pop();
  let target = object;

  for (const key of keys) target = target[key];
  delete target[last];
};

const detailsOf = (testCase) => {
  if ("details" in testCase) return testCase.details;

  const details = structuredClone(shared.bases[testCase.profile]);

  for (const [dotted, value] of Object.entries(testCase.set ?? {})) setPath(details, dotted, valueOf(value));
  for (const dotted of testCase.remove ?? []) removePath(details, dotted);

  return details;
};

describe("the shared cases", () => {
  test("the file was read (a guard against this passing on nothing)", () => {
    assert.equal(shared.cases.length, 59);
  });

  for (const testCase of shared.cases)
    test(`${testCase.profile}: ${testCase.name}`, () => {
      const { value, errors } = validateDetails(testCase.profile, detailsOf(testCase), context);

      assert.deepEqual(Object.keys(errors).sort(), testCase.error_keys);

      // A valid set of details comes back as a value; an invalid one never does.
      if (testCase.error_keys.length > 0) assert.equal(value, null);
    });

  test("the copy in docs/, where there is one, is this file", { skip: !fs.existsSync(SOURCE) }, () => {
    // a checkout may turn the line endings of one of the two into CRLF; the cases are what must match
    const text = (file) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");

    assert.equal(text(SOURCE), text(FIXTURE));
  });
});

const death = () => structuredClone(shared.bases.death);

describe("what comes back", () => {
  test("a valid base comes back as it went in, minus what was not given", () => {
    const { value, errors } = validateDetails("death", death(), context);

    assert.deepEqual({ ...errors }, {});
    // other_conditions is "" in the base: an empty string means not given.
    assert.equal("other_conditions" in value.condition, false);
    assert.deepEqual(Object.keys(value), ["claimant", "event", "condition"]);
    assert.equal(value.condition.immediate_cause, "Myocardial infarction");
  });

  test("text is trimmed", () => {
    const input = death();
    input.claimant.name = "  Carlos Santos  ";
    input.event.place = "\tPasay City\n";

    const { value } = validateDetails("death", input, context);

    assert.equal(value.claimant.name, "Carlos Santos");
    assert.equal(value.event.place, "Pasay City");
  });

  test("a contact number is kept in BES's own form: +63 and separators folded", () => {
    const input = death();
    input.claimant.contact_no = " +63 917-123-4567 ";

    const { value, errors } = validateDetails("death", input, context);

    assert.deepEqual({ ...errors }, {});
    assert.equal(value.claimant.contact_no, "09171234567");
  });

  test("a value that is nothing but spaces is not given", () => {
    const input = death();
    input.claimant.email_address = "   ";

    const { value, errors } = validateDetails("death", input, context);

    assert.deepEqual({ ...errors }, {});
    assert.equal("email_address" in value.claimant, false);
  });

  // The server works these out. A client that sends them is refused, not ignored.
  test("insured, computed and coverage cannot be sent", () => {
    const input = { ...death(), insured: {}, computed: {}, coverage: [] };

    const { errors } = validateDetails("death", input, context);

    assert.deepEqual(Object.keys(errors).sort(), ["computed", "coverage", "insured"]);
  });

  test("a section that is missing names its required fields, one by one", () => {
    const input = death();
    delete input.claimant;

    const { errors } = validateDetails("death", input, context);

    assert.deepEqual(Object.keys(errors).sort(), ["claimant.contact_no", "claimant.name", "claimant.relationship"]);
  });

  test("a section that is not an object is one error on the section", () => {
    for (const bad of ["Carlos", 5, [], null]) {
      const input = death();
      input.claimant = bad;

      const { errors } = validateDetails("death", input, context);

      assert.deepEqual(Object.keys(errors), ["claimant"], JSON.stringify(bad));
    }
  });

  test("details that are not an object are one error", () => {
    for (const bad of ["x", 5, true, []]) {
      const { errors } = validateDetails("death", bad, context);

      assert.deepEqual(Object.keys(errors), ["details"], JSON.stringify(bad));
    }
  });

  test("a field that is not text is refused, whatever it is", () => {
    for (const bad of [5, true, {}, ["x"]]) {
      const input = death();
      input.condition.immediate_cause = bad;

      const { errors } = validateDetails("death", input, context);

      assert.deepEqual(Object.keys(errors), ["condition.immediate_cause"], JSON.stringify(bad));
    }
  });

  // Names an object has before anyone gives it any. Sent as JSON they are real keys.
  test("a key such as __proto__ is an unknown key, not a way in", () => {
    const input = JSON.parse('{"claimant": {"__proto__": {"polluted": true}}}');

    const { errors } = validateDetails("death", input, context);

    assert.ok("claimant.__proto__" in errors);
    assert.equal({}.polluted, undefined);
  });

  test("the checks that need a date use the one given, so a test can fix it", () => {
    const input = death();
    input.event.date = "2026-11-05";

    assert.deepEqual(Object.keys(validateDetails("death", input, { ...context, today: "2026-11-04" }).errors), ["event.date"]);
    assert.deepEqual({ ...validateDetails("death", input, { ...context, today: "2026-11-05" }).errors }, {});
  });

  // Without a birthdate (an enrollment that has none) only that one check is skipped.
  test("without a birthdate the date of birth check is left out and the rest stays", () => {
    const input = death();
    input.event.date = "1991-03-13";

    assert.deepEqual({ ...validateDetails("death", input, { today: context.today }).errors }, {});

    input.event.date = "2026-11-05";
    assert.deepEqual(Object.keys(validateDetails("death", input, { today: context.today }).errors), ["event.date"]);
  });

  test("an unknown profile is a programming error, not a validation answer", () => {
    assert.throws(() => validateDetails("pension", {}, context), /No details schema/);
  });
});

describe("the messages", () => {
  const { errors } = validateDetails(
    "dismemberment",
    { claimant: { name: "", relationship: "FRIEND", contact_no: "1" }, event: { date: "x" }, condition: {}, extra: 1 },
    context,
  );

  test("name the field in a plain sentence, ready to show beside it", () => {
    assert.equal(errors["claimant.name"], "Enter the claimant's name.");

    for (const [key, message] of Object.entries(errors)) {
      assert.match(message, /^[A-Z].*\.$/, key);
      assert.doesNotMatch(message, /[\u2014\u2013]/, `${key} has a dash`);
      assert.doesNotMatch(message, /undefined|\[object/, key);
    }
  });

  test("do not echo what was typed", () => {
    for (const message of Object.values(errors)) assert.doesNotMatch(message, /FRIEND/);
  });
});

describe("parseDetails", () => {
  test("nothing sent is not given", () => {
    for (const nothing of [undefined, null, "", "   "]) assert.deepEqual(parseDetails(nothing), { input: undefined });
  });

  test("JSON text from the multipart form is parsed", () => {
    assert.deepEqual(parseDetails('{"a": 1}'), { input: { a: 1 } });
  });

  test("an object from a JSON request is taken as it is", () => {
    assert.deepEqual(parseDetails({ a: 1 }), { input: { a: 1 } });
  });

  test("text that is not JSON is one error on details, and does not quote the text", () => {
    const { errors } = parseDetails("{not json: secret");

    assert.deepEqual(Object.keys(errors), ["details"]);
    assert.doesNotMatch(errors.details, /secret/);
  });

  test("12 000 characters are allowed and one more is not", () => {
    const at = JSON.stringify({ pad: "x".repeat(MAX_DETAILS_CHARS - '{"pad":""}'.length) });
    assert.equal(at.length, MAX_DETAILS_CHARS);
    assert.equal(parseDetails(at).errors, undefined);

    const over = at.replace('"pad":"', '"pad":"x');
    assert.equal(over.length, MAX_DETAILS_CHARS + 1);
    assert.match(parseDetails(over).errors.details, /12000 characters or fewer/);
  });

  test("the limit holds for an object from a JSON request too", () => {
    const { errors } = parseDetails({ pad: "x".repeat(MAX_DETAILS_CHARS) });

    assert.match(errors.details, /12000 characters/);
  });
});

describe("checkDetails", () => {
  test("reads the text and then checks it", () => {
    const ok = checkDetails("death", JSON.stringify(death()), context);
    assert.deepEqual({ ...ok.errors }, {});
    assert.equal(ok.value.claimant.name, "Carlos Santos");

    const bad = checkDetails("death", '{"claimant": {}}', context);
    assert.ok("claimant.name" in bad.errors);
    assert.equal(bad.value, null);
  });

  test("a general claim takes nothing, and nothing is fine", () => {
    const nothing = checkDetails("general", undefined, context);
    assert.equal(nothing.value, null);
    assert.deepEqual({ ...nothing.errors }, {});
    assert.deepEqual(Object.keys(checkDetails("general", "{}", context).errors), ["details"]);
  });

  test("a claim that needs details and has none sent is an error on details", () => {
    for (const nothing of [undefined, "", null, "null"])
      assert.deepEqual(Object.keys(checkDetails("tpd", nothing, context).errors), ["details"], String(nothing));
  });

  test("text that is too long is refused before it is parsed", () => {
    const { errors } = checkDetails("death", "x".repeat(MAX_DETAILS_CHARS + 1), context);

    assert.match(errors.details, /characters or fewer/);
  });
});

// Names every object has before anyone gives it any. Sent as JSON text they are real keys, and a key
// the form does not have is refused wherever it is, whatever its name.
describe("keys named like an object's own", () => {
  const withKey = (where, key) => {
    const base = JSON.stringify(death());
    const extra = `"${key}": {"polluted": true}`;

    return JSON.parse(where === "top" ? base.replace("{", `{${extra},`) : base.replace('"claimant":{', `"claimant":{${extra},`));
  };

  for (const key of ["__proto__", "constructor", "prototype", "toString", "hasOwnProperty"]) {
    test(`${key} at the top is an unknown key`, () => {
      const { value, errors } = validateDetails("death", withKey("top", key), context);

      assert.deepEqual(Object.keys(errors), [key]);
      assert.equal(value, null);
    });

    test(`${key} in a section is an unknown key`, () => {
      const { errors } = validateDetails("death", withKey("claimant", key), context);

      assert.deepEqual(Object.keys(errors), [`claimant.${key}`]);
    });
  }

  test("the JSON text of the details is read as it was written, the key included", () => {
    const { input } = parseDetails('{"__proto__": {"x": 1}}');

    assert.deepEqual(Object.keys(input), ["__proto__"]);
  });

  test("the errors map has no prototype to set", () => {
    const { errors } = validateDetails("death", JSON.parse('{"__proto__": {"x": 1}, "extra": 1}'), context);

    assert.equal(Object.getPrototypeOf(errors), null);
    assert.ok(Object.keys(errors).includes("__proto__") && Object.keys(errors).includes("extra"));
    assert.equal(typeof errors.__proto__, "string");
    assert.equal({}.polluted, undefined);
  });

  test("no profile lets one through", () => {
    for (const profile of ["tpd", "terminal_illness", "dismemberment"])
      assert.ok("__proto__" in validateDetails(profile, JSON.parse('{"__proto__": 1}'), context).errors, profile);
  });

  test("a general claim refuses details with such a key, as it refuses any", () => {
    assert.deepEqual(Object.keys(validateDetails("general", JSON.parse('{"__proto__": 1}'), context).errors), ["details"]);
  });
});
