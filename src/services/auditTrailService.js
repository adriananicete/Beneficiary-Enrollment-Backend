import AuditTrailModel from "../models/auditTrailModel.js";
import { AppError } from "../utils/AppError.js";
import { buildPage, parsePaging, parseSearch } from "../utils/parsePaging.js";
import { plainAddress } from "../utils/integrationKeys.js";
import { isoDateRangeOf } from "../utils/isoDate.js";

// The CRUD audit trail, DBA request 34 (decided with Adrian, 2026-11-11):
// - a row is written after the request has succeeded, not in its transaction,
//   so this is the Administrator's record of who did what, not proof that no
//   change went unrecorded;
// - what changed is JSON in us07_old_values / us07_new_values when the app
//   knows it, `{}` otherwise; never a password, a hash, a token or a file;
// - no session rows and no tokens stored: the session id is NULL;
// - the list is the Administrator's only, with no retention for now.

export const AUDIT_ACTIONS = { I: "CREATE", U: "UPDATE", D: "DELETE" };

// JSON of a plain object, or NULL: the procedure stores NULL as "{}".
const valuesText = (values) =>
  values && typeof values === "object" && !Array.isArray(values) ? JSON.stringify(values) : null;

// The row as the procedure takes it. Exported for the tests.
export const auditRowOf = (entry) => ({
  userId: entry.userId,
  objectName: String(entry.objectName).slice(0, 100),
  recordId: entry.recordId ?? null,
  action: entry.action,
  // The procedure refuses an empty address (50233).
  ipAddress: String(plainAddress(entry.ipAddress) || "unknown").slice(0, 45),
  oldValues: valuesText(entry.oldValues),
  newValues: valuesText(entry.newValues),
});

// Writes one row and never fails the caller: the action has already happened,
// and undoing it because its log row failed would be worse. A failure goes to
// the server log with the module and action, nothing about the person.
// `pool` may be a promise.
export const recordAuditEntry = async (pool, entry, { model = AuditTrailModel, log = console.error } = {}) => {
  try {
    await model.insertAuditLog(await pool, auditRowOf(entry));
  } catch (error) {
    log(`Audit trail: could not record ${entry?.action} on ${entry?.objectName}`, error);
  }
};

// ── The Administrator's list ────────────────────────────────────────────────

const byCode = Object.fromEntries(Object.entries(AUDIT_ACTIONS).map(([code, word]) => [word, code]));

// ?username=&module=&action=&from_date=&to_date=&page=&pageSize=. The username
// is a prefix; the module is exact; the action is CREATE, UPDATE or DELETE.
export const parseAuditQuery = (query = {}) => {
  const username = parseSearch(query.username);
  if (username !== null && username.length > 50) throw new AppError("username can be at most 50 characters", 400);

  const objectName = parseSearch(query.module);
  if (objectName !== null && objectName.length > 100) throw new AppError("module can be at most 100 characters", 400);

  let action = null;
  if (query.action !== undefined && query.action !== "") {
    action = typeof query.action === "string" ? byCode[query.action.toUpperCase()] ?? null : null;
    if (action === null) throw new AppError(`action must be one of ${Object.values(AUDIT_ACTIONS).join(", ")}`, 400);
  }

  return { username, objectName, action, ...isoDateRangeOf(query, "from_date", "to_date"), ...parsePaging(query) };
};

// Stored values back to objects. A value that is not JSON, which the app never
// writes, is shown as it is rather than failing the list.
const parsed = (text) => {
  if (text === null || text === undefined) return {};

  try {
    return JSON.parse(text);
  } catch {
    return { value: String(text) };
  }
};

export const auditLogOf = (row) => ({
  audit_log_id: row.audit_log_id,
  executed_at: row.executed_at,
  user: { user_id: row.us01_user_id, username: row.username, first_name: row.first_name, last_name: row.last_name },
  module: row.object_name,
  // 0 is how the procedure stores "no single record".
  record_id: row.record_id && String(row.record_id) !== "0" ? row.record_id : null,
  action: AUDIT_ACTIONS[row.action] ?? row.action,
  old_values: parsed(row.old_values),
  new_values: parsed(row.new_values),
  ip_address: row.ip_address,
});

// The paged list. The procedure refuses anyone but an Administrator (50236).
export const listAuditLogs = async (pool, userId, query, { model = AuditTrailModel } = {}) => {
  const filters = parseAuditQuery(query);
  const records = await model.getAuditLogs(pool, userId, filters);

  return buildPage(records, filters, auditLogOf);
};

export default { AUDIT_ACTIONS, recordAuditEntry, parseAuditQuery, listAuditLogs };
