import { sql } from "../config/db.js";

const FILTERS = `
  WHERE (@search IS NULL
      OR CAST(a.us07_audit_log_id AS nvarchar(20)) LIKE @search
      OR u.us01_username LIKE @search
      OR u.us01_first_name LIKE @search
      OR u.us01_last_name LIKE @search
      OR a.us07_object_name LIKE @search
      OR CAST(a.us07_record_id AS nvarchar(20)) LIKE @search
      OR a.us07_action LIKE @search
      OR a.us07_ip_address LIKE @search)
    AND (@from_date IS NULL OR a.us07_executed_at >= @from_date)
    AND (@to_date IS NULL OR a.us07_executed_at < DATEADD(DAY, 1, @to_date))
    AND (@status IS NULL OR @status = 'SUCCESS')
`;

const bindFilters = (request, { search, status, from, to }) =>
  request
    .input("search", sql.NVarChar(102), search ? `%${search}%` : null)
    .input("status", sql.VarChar(7), status)
    .input("from_date", sql.Date, from ? new Date(`${from}T00:00:00.000Z`) : null)
    .input("to_date", sql.Date, to ? new Date(`${to}T00:00:00.000Z`) : null);

const getAuditTrail = async (pool, { page, pageSize, search, status, from, to }) => {
  const filters = { search, status, from, to };
  const countResult = await bindFilters(pool.request(), filters).query(`
    SELECT COUNT_BIG(*) AS total_count
    FROM sec.us07_audit_logs AS a
    LEFT JOIN sec.us01_users AS u ON u.us01_user_id = a.us01_user_id
    ${FILTERS}
  `);

  const rowsResult = await bindFilters(pool.request(), filters)
    .input("offset", sql.BigInt, String((page - 1) * pageSize))
    .input("page_size", sql.Int, pageSize)
    .query(`
      SELECT
        a.us07_audit_log_id AS audit_id,
        a.us07_executed_at AS created_at,
        u.us01_username AS username,
        LTRIM(RTRIM(CONCAT(ISNULL(u.us01_first_name, ''), ' ', ISNULL(u.us01_last_name, '')))) AS user_full_name,
        CASE a.us07_action
          WHEN 'I' THEN 'CREATE'
          WHEN 'U' THEN 'UPDATE'
          WHEN 'D' THEN 'DELETE'
          WHEN 'L' THEN 'LOGIN'
          ELSE a.us07_action
        END AS action,
        a.us07_object_name AS module,
        a.us07_record_id AS record_id,
        a.us07_old_values AS old_values,
        a.us07_new_values AS new_values,
        a.us07_ip_address AS ip_address,
        'SUCCESS' AS outcome
      FROM sec.us07_audit_logs AS a
      LEFT JOIN sec.us01_users AS u ON u.us01_user_id = a.us01_user_id
      ${FILTERS}
      ORDER BY a.us07_executed_at DESC, a.us07_audit_log_id DESC
      OFFSET @offset ROWS FETCH NEXT @page_size ROWS ONLY
    `);

  return {
    rows: rowsResult.recordset,
    total: Number(countResult.recordset[0]?.total_count ?? 0),
  };
};

const getRecentAuditIds = async (pool, limit = 100) => {
  const result = await pool.request()
    .input("limit", sql.Int, limit)
    .query(`
      SELECT TOP (@limit) us07_audit_log_id AS audit_id
      FROM sec.us07_audit_logs
      ORDER BY us07_audit_log_id DESC
    `);

  return result.recordset.map(({ audit_id }) => String(audit_id));
};

const getAuditIdsAfter = async (pool, auditId) => {
  const result = await pool.request()
    .input("after_audit_id", sql.BigInt, auditId)
    .query(`
      SELECT us07_audit_log_id AS audit_id
      FROM sec.us07_audit_logs
      WHERE us07_audit_log_id > @after_audit_id
      ORDER BY us07_audit_log_id
    `);

  return result.recordset.map(({ audit_id }) => String(audit_id));
};

export default { getAuditTrail, getRecentAuditIds, getAuditIdsAfter };
