import { sql, poolPromise } from "../config/db.js";

const findAdminByUsername = async (username) => {
  const pool = await poolPromise;
  const result = await pool
    .request()
    .input("username", sql.NVarChar, username)
    .query(
      `SELECT AdminID, Username, PasswordHash, CompanyID, Role FROM [enrollment].[Admins] WHERE Username = @username;`,
    );

  return result.recordset[0];
};

export default { findAdminByUsername };
