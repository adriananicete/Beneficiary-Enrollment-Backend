import { sql } from "../config/db.js";

export const generateRefNumber = async (pool, companyId) => {
    const companyCounterResult = await pool.request()
    .input('companyId', sql.Int, companyId)
    .query(`
        UPDATE [enrollment].[CompanyCounters]
        SET LastNumber = LastNumber + 1
        OUTPUT INSERTED.LastNumber
        WHERE CompanyID = @companyId;
        `);

    const lastNumber = companyCounterResult.recordset[0].LastNumber

    const companyResult = await pool.request()
    .input('companyId', sql.Int, companyId)
    .query(`SELECT Prefix FROM [enrollment].[Companies] WHERE CompanyID = @companyId`);

    const companyPrefix = companyResult.recordset[0].Prefix

    return `${companyPrefix}-${lastNumber.toString().padStart(4, '0')}`
}