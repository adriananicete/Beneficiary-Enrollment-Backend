import { sql } from "../config/db.js";

// The development wipe, DBA request 26, read back 2026-10-15. Deletes every
// person whose every employment record is with this company, whole, in its own
// transaction, and keeps the company, its classes, affiliates, HR account and
// invitations. No OUTPUT parameter.
//
// THROWs 50220 (not an active Administrator, nor this company's active HR),
// 50187 (no such company) and 50221 (the confirmation is not its code), all
// before the transaction opens.
const wipeCompanyEnrollees = async (pool, userId, employerId, confirmCode) => {
    const result = await pool.request()
    .input('us01_user_id', sql.BigInt, userId)
    .input('employer_id', sql.BigInt, employerId)
    .input('confirm_code', sql.VarChar(50), confirmCode)
    .execute('usp_del_company_enrollees');

    return result.recordset[0];
};

export default { wipeCompanyEnrollees };
