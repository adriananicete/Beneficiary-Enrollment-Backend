import { sql } from "../config/db.js";

// Ending an employee's employment, DBA request 39, read back word for word
// 2026-11-23 (md/DBA-REQUEST-39.md). Neither procedure declares an OUTPUT
// parameter, and each owns its transaction: they are called on their own.

// Closes the enrollment ('I'), records the reason and the date on the
// employment record, cancels pending change requests and closes the login
// (us01_is_active 0, token version + 1). HR of the company or the
// Administrator; THROWs 50237–50245. Returns { client_id, enrollment_id,
// employment_end_reason, employment_end_date, cancelled_requests,
// us01_user_id }.
//
// The date is bound from "YYYY-MM-DD" text as sql.Date, as the date of death
// is.
const endEmployment = async (pool, { clientId, reason, endDate, userId }) => {
  const result = await pool
    .request()
    .input("client_id", sql.BigInt, clientId)
    .input("end_reason", sql.VarChar(20), reason)
    .input("end_date", sql.Date, endDate)
    .input("us01_user_id", sql.BigInt, userId)
    .execute("bes.usp_upd_employment_end");

  return result.recordset[0];
};

// The undo, Administrator only (50246). Reopens the enrollment and the login,
// unless an approved claim that ends coverage closed it (50250). Cancelled
// change requests stay cancelled. THROWs 50246–50250. Returns { client_id,
// enrollment_id }.
const undoEmploymentEnd = async (pool, { clientId, userId }) => {
  const result = await pool
    .request()
    .input("client_id", sql.BigInt, clientId)
    .input("us01_user_id", sql.BigInt, userId)
    .execute("bes.usp_del_employment_end");

  return result.recordset[0];
};

export default { endEmployment, undoEmploymentEnd };
