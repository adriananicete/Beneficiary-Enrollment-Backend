import { sql } from "../config/db.js";

// The CRUD audit trail, DBA request 34. Through the two procedures only; the
// teammates wrote the row with a plain INSERT because sec.usp_ins_audit_log
// could not insert one (515), which request 34 fixes.

// One row. Called on its own, after the change it records has completed. The
// values are JSON text or NULL; the procedure stores NULL as "{}". The id comes
// back as a row: there is no OUTPUT parameter since request 34.
const insertAuditLog = async (
  pool,
  { userId, objectName, recordId = null, action, ipAddress, oldValues = null, newValues = null },
) => {
  const result = await pool
    .request()
    .input("us01_user_id", sql.BigInt, userId)
    .input("us07_object_name", sql.VarChar(100), objectName)
    .input("us07_record_id", sql.BigInt, recordId)
    .input("us07_action", sql.Char(1), action)
    .input("us07_ip_address", sql.VarChar(45), ipAddress)
    .input("us06_session_id", sql.BigInt, null)
    .input("us07_old_values", sql.NVarChar(sql.MAX), oldValues)
    .input("us07_new_values", sql.NVarChar(sql.MAX), newValues)
    .execute("sec.usp_ins_audit_log");

  return result.recordset[0];
};

// The Administrator's list, newest first. THROWs 50236 for anyone else. Each
// row carries total_count (COUNT(*) OVER()) for the paging envelope.
const getAuditLogs = async (
  pool,
  userId,
  { username = null, objectName = null, action = null, fromDate = null, toDate = null, page, pageSize },
) => {
  const result = await pool
    .request()
    .input("us01_user_id", sql.BigInt, userId)
    .input("username", sql.VarChar(50), username)
    .input("object_name", sql.VarChar(100), objectName)
    .input("action", sql.Char(1), action)
    .input("from_date", sql.Date, fromDate)
    .input("to_date", sql.Date, toDate)
    .input("page", sql.Int, page)
    .input("page_size", sql.Int, pageSize)
    .execute("sec.usp_sel_audit_logs");

  return result.recordset;
};

export default { insertAuditLog, getAuditLogs };
