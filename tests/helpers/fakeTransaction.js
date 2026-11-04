// Lets the claim service run its whole transaction against a fake pool. The service opens it with
// `new sql.Transaction(pool)`, and mssql would ask the pool for a real connection; here the four
// methods the service uses are replaced, and a request made through the transaction goes to the
// fake pool, so the procedures it calls are recorded and answered like any others.
//
// tests/services/claimService.test.js stops at the transaction ("a fake transaction agrees with
// whatever it is told"). This is for the code that runs after it commits, which has to be shown
// to run only then: the answer of the commit is the test's to choose.
import { mock } from "node:test";

export const fakeTransactions = (sql, pool, { failCommit = false } = {}) => {
  const log = { begun: 0, committed: 0, rolledBack: 0 };
  const prototype = sql.Transaction.prototype;

  mock.method(prototype, "begin", async () => {
    log.begun++;
  });
  mock.method(prototype, "commit", async () => {
    if (failCommit) throw new Error("commit failed");
    log.committed++;
  });
  mock.method(prototype, "rollback", async () => {
    log.rolledBack++;
  });
  mock.method(prototype, "request", () => pool.request());

  return log;
};

export const restoreTransactions = () => mock.restoreAll();

export default { fakeTransactions, restoreTransactions };
