import { sql } from "../config/db.js";

const createEmployee = async (pool, employeeData) => {
  const result = await pool
    .request()
    .input("employeeIdNum", sql.NVarChar, employeeData.employeeIdNum)
    .input("email", sql.NVarChar, employeeData.email)
    .input("passwordHash", sql.NVarChar, employeeData.passwordHash)
    .input("enrollmentId", sql.Int, employeeData.enrollmentId)
    .input("companyId", sql.Int, employeeData.companyId)
    .query(
      `
        INSERT INTO enrollment.Employees
      ([EmployeeIdNumber]
      ,[Email]
      ,[PasswordHash]
      ,[EnrollmentID]
      ,[CompanyID]) 
      VALUES (
      @employeeIdNum, @email, @passwordHash, @enrollmentId, @companyId)
        `,
    );
};
