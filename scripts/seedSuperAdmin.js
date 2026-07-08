import { sql, poolPromise } from "../src/config/db.js";
import bcrypt from "bcrypt";

const seedSuperAdmin = async () => {
  try {
    const username = "ebamadmin";
    const password = "admin123";
    const pool = await poolPromise;
    const hashedPassword = await bcrypt.hash(password, 10);

    const generateId = await pool
      .request()
      .input("name", sql.NVarChar, "phillife")
      .input("prefix", sql.NVarChar, "PL").query(`
            INSERt INTO enrollment.Companies (CompanyName, Prefix)
            VALUES (@name, @prefix);
            SELECT SCOPE_IDENTITY() AS CompanyID

        `);
    
    
    const ebamID = generateId.recordset[0].CompanyID;

    const superAdminCompanyCounter = await pool.request()
    .input('companyId', sql.Int, ebamID)
    .query(
        `
            INSERT INTO enrollment.CompanyCounters (CompanyID, LastNumber) VALUES (@companyId, 0)
        `
    );

    const superAdminAccount = await pool.request()
    .input('username', sql.NVarChar, username)
    .input('passwordHash', sql.NVarChar, hashedPassword)
    .input('companyId', sql.Int, ebamID)
    .input('role', sql.NVarChar, 'superadmin')
    .query(`
            INSERT INTO enrollment.Admins (Username, PasswordHash, CompanyID, Role) VALUES (@username, @passwordHash, @companyId, @role)
        `)

    console.log('Super admin seeded successfully!')
    process.exit(0)
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};

seedSuperAdmin();