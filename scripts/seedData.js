import { sql, poolPromise } from "../src/config/db.js";
import bcrypt from "bcrypt";

async function seed() {
  try {
    const password = "admin123";

    const pool = await poolPromise;
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const hclResults = await pool
      .request()
      .input("name", sql.NVarChar, "HCL")
      .input("prefix", sql.NVarChar, "HCL")
      .query(
        `INSERT INTO enrollment.Companies  (CompanyName, Prefix) VALUES (@name, @prefix); SELECT SCOPE_IDENTITY() AS CompanyID`,
      );

    const coforgeResults = await pool
      .request()
      .input("name", sql.NVarChar, "COFORGE")
      .input("prefix", sql.NVarChar, "COFORGE")
      .query(
        `INSERT INTO enrollment.Companies  (CompanyName, Prefix) VALUES (@name, @prefix); SELECT SCOPE_IDENTITY() AS CompanyID`,
      );

    const hclId = hclResults.recordset[0].CompanyID;
    const coforgeId = coforgeResults.recordset[0].CompanyID;

    const hclCountersResults = await pool
      .request()
      .input("companyId", sql.Int, hclId)
      .query(
        `INSERT INTO enrollment.CompanyCounters (CompanyID, LastNumber) VALUES (@companyId, 0)`,
      );

    const coforgeCountersResults = await pool
      .request()
      .input("companyId", sql.Int, coforgeId)
      .query(
        `INSERT INTO enrollment.CompanyCounters (CompanyID, LastNumber) VALUES (@companyId, 0)`,
      );

    const adminHclResult = await pool
      .request()
      .input("username", sql.NVarChar, 'hcl_admin')
      .input("passwordHash", sql.NVarChar, hashedPassword)
      .input("companyId", sql.Int, hclId)
      .query(
        `INSERT INTO enrollment.Admins (Username, PasswordHash, CompanyID) 
        VALUES (@username, @passwordHash, @companyId)`,
      );

      const adminCoforgeResult = await pool
      .request()
      .input("username", sql.NVarChar, 'coforge_admin')
      .input("passwordHash", sql.NVarChar, hashedPassword)
      .input("companyId", sql.Int, coforgeId)
      .query(
        `INSERT INTO enrollment.Admins (Username, PasswordHash, CompanyID) 
        VALUES (@username, @passwordHash, @companyId)`,
      );

    console.log("Seed data inserted successfully!");
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

seed()