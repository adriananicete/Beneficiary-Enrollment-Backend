import sql from "mssql";
import config from "./env.js";

const dbConfig = {
  server: config.db.server,
  user: config.db.user,
  password: config.db.password,
  database: config.db.name,
  port: config.db.port,
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
};

const poolPromise = new sql.ConnectionPool(dbConfig).connect().then(pool => {
    console.log('Database connected!');
    return pool;
}).catch(err => console.error(err));

export { sql, poolPromise };
