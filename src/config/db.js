import sql from "mssql";
import config from "./env.js";

const dbConfig = {
  server: config.db.server,
  user: config.db.user,
  password: config.db.password,
  database: config.db.name,
  port: config.db.port,
  options: {
    encrypt: config.db.encrypt,
    trustServerCertificate: config.db.trustServerCertificate,
  },
};

// The pool is built on the first call rather than at import.
//
// Connecting at import made this module unreachable from a test. The import
// alone opened a connection, and its failure path called process.exit(1) — so a
// test that touched any controller, model or service killed the runner rather
// than failing an assertion. Every file behind the database was untestable,
// including the pure logic sitting in front of it.
//
// Fail-fast was not dropped, it moved. server.js awaits this before app.listen
// and exits on failure, so the server still refuses to start without a
// database. What changed is that a connection lost after boot now fails the
// request rather than the process.
let poolPromise = null;

const getPool = () => {
  if (poolPromise) return poolPromise;

  poolPromise = new sql.ConnectionPool(dbConfig)
    .connect()
    .then((pool) => {
      console.log("Database connected!");
      return pool;
    })
    .catch((err) => {
      // Forget the failure so the next caller connects again. Holding a
      // rejected promise here would make one bad connect permanent for the
      // life of the process, and the caller reporting it would be whoever
      // happened to ask an hour later.
      poolPromise = null;
      throw err;
    });

  return poolPromise;
};

export { sql, getPool };
