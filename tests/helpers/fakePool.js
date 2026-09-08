// A pool that remembers what it was asked and answers from a script.
//
// No mocking library and no experimental flag: every model takes its pool as
// the first argument and only ever calls `.request().input(...).execute(name)`,
// so an object with that shape is enough. `mock.module` was the alternative and
// is still behind --experimental-test-module-mocks in this Node, where a
// mis-registered specifier connects to the real database — the exact failure
// the lazy pool in PR #87 existed to end.
//
// Written inline in dashboardService.test.js first (PR #95) and moved here when
// the second and third services needed it, rather than copied.
//
// `answers` is keyed by procedure name. A value is either the recordset to
// return, or a function of the recorded inputs for when the answer depends on
// what was asked. An unscripted procedure throws by name rather than returning
// an empty set: a service that quietly reads a procedure the test never
// considered is exactly what this should surface.
export const fakePool = (answers) => {
  const calls = [];

  const request = () => {
    const inputs = {};

    const chain = {
      input(name, type, value) {
        inputs[name] = value;
        return chain;
      },
      output(name, type, value) {
        inputs[name] = value;
        return chain;
      },
      async execute(procedure) {
        calls.push({ procedure, inputs });

        const answer = answers[procedure];
        if (answer === undefined)
          throw new Error(`fake pool has no answer for ${procedure}`);

        return typeof answer === "function"
          ? answer(inputs)
          : { recordset: answer, output: {} };
      },
    };

    return chain;
  };

  return { pool: { request }, calls };
};

// The inputs a procedure was called with, for asserting that a filter or a
// scoping id actually reached the database rather than being dropped on the way.
export const inputsFor = (calls, procedure) =>
  calls.find((call) => call.procedure === procedure)?.inputs;

export default { fakePool, inputsFor };
