import { sql } from "../config/db.js";

// The security event log, DBA request 28. The table takes rows only through
// these procedures: the insert, and the Administrator's paged list.

// One event. The id comes back as a row (no OUTPUT parameter, so the trap of
// item 14 cannot recur).
const insertSecurityEvent = async (
  pool,
  { eventType, userId = null, username = null, actorUserId = null, ipAddress = null, userAgent = null, detail = null },
) => {
  const result = await pool.request()
    .input("event_type", sql.VarChar(40), eventType)
    .input("us01_user_id", sql.BigInt, userId)
    .input("username", sql.VarChar(50), username)
    .input("actor_user_id", sql.BigInt, actorUserId)
    .input("ip_address", sql.VarChar(45), ipAddress)
    .input("user_agent", sql.VarChar(500), userAgent)
    .input("detail", sql.VarChar(100), detail)
    .execute("sec.us09_usp_ins_security_event");

  return result.recordset[0];
};

// Newest first. THROWs 50224 for anyone but an active Administrator. Each row
// carries total_count (COUNT(*) OVER()) for the paging envelope.
const getSecurityEvents = async (
  pool,
  userId,
  { eventType = null, username = null, fromDate = null, toDate = null, page, pageSize },
) => {
  const result = await pool.request()
    .input("us01_user_id", sql.BigInt, userId)
    .input("event_type", sql.VarChar(40), eventType)
    .input("username", sql.VarChar(50), username)
    .input("from_date", sql.Date, fromDate)
    .input("to_date", sql.Date, toDate)
    .input("page", sql.Int, page)
    .input("page_size", sql.Int, pageSize)
    .execute("sec.us09_usp_sel_security_events");

  return result.recordset;
};

export default { insertSecurityEvent, getSecurityEvents };
