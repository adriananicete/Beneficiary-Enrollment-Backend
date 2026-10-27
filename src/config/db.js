import sql from "mssql";
import config from "./env.js";
import { localIsoDate } from "../utils/localDate.js";

const dbConfig = {
  server: config.db.server,
  user: config.db.user,
  password: config.db.password,
  database: config.db.name,
  port: config.db.port,
  options: {
    encrypt: config.db.encrypt,
    trustServerCertificate: config.db.trustServerCertificate,
    // The database writes Philippine local time (GETDATE(), at +08:00) into
    // columns that carry no time zone. With the driver's default, useUTC:
    // true, every one of those came back labelled UTC: written at 13:19 local,
    // answered as "13:19Z", which is 21:19 to anybody who converts it, as
    // FRONTEND-API.md told the frontend to. Found 2026-10-06.
    //
    // false reads them in this process's time zone, which timezone.js sets to
    // Philippine time, so the API now answers with the true instant: 13:19
    // local is "05:19Z". Decided by Adrian, 2026-10-06: the backend's times
    // must be right.
    useUTC: false,
  },
};

// DATE columns (birthdate) carry no time of day. With useUTC: false the
// driver reads 1990-05-01 as Philippine midnight, which JSON prints as
// "1990-04-30T16:00:00.000Z": a day early to anybody who keeps the first ten
// characters. So every DATE column leaves as "1990-05-01", the same form the
// API takes dates in. Decided 2026-10-06.
//
// Done here, from the driver's own column metadata, so every procedure and
// every query is covered without each model having to remember. Only columns
// the driver reports as DATE are touched; datetimes stay Date objects.
export const datesAsText = (result) => {
  for (const recordset of result?.recordsets ?? []) {
    const dateColumns = Object.values(recordset.columns ?? {})
      .filter((column) => column.type === sql.Date)
      .map((column) => column.name);

    if (dateColumns.length === 0) continue;

    for (const row of recordset)
      for (const name of dateColumns)
        if (row[name] instanceof Date) row[name] = localIsoDate(row[name]);
  }

  return result;
};

// Applied to every request, on a pool or inside a transaction, by wrapping
// the two methods every model calls. Promise calls only; this codebase never
// passes a callback, and one passed anyway goes to the original untouched.
// Wrapped once, however many times this module is evaluated.
const WRAPPED = Symbol.for("beneficiary-enrollment.datesAsText");

if (!sql.Request.prototype[WRAPPED]) {
  for (const method of ["execute", "query"]) {
    const original = sql.Request.prototype[method];

    sql.Request.prototype[method] = function (...args) {
      if (typeof args[args.length - 1] === "function")
        return original.apply(this, args);

      return original.apply(this, args).then(datesAsText);
    };
  }

  sql.Request.prototype[WRAPPED] = true;
}

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

export { sql, getPool, dbConfig };
