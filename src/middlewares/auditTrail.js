import { getPool } from "../config/db.js";
import AuditTrailModel from "../models/auditTrailModel.js";
import { AUDITED_ROUTES } from "../utils/auditCatalog.js";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const API_PREFIX = "/api/v1";
const POSITIVE_ID = /^[1-9]\d*$/;

// The route as declared, under /api/v1: "PATCH /admin/companies/:employer_id".
// Read when the response is done, because that is when Express knows which
// route answered.
export const routeKeyOf = (req, apiPrefix = API_PREFIX) => {
  if (typeof req.route?.path !== "string") return null;

  const path = `${req.baseUrl ?? ""}${req.route.path}`;
  return `${req.method} ${path.startsWith(apiPrefix) ? path.slice(apiPrefix.length) : path}`;
};

// The first source that gives an id above zero (the procedure refuses any other).
// See AUDITED_ROUTES for what "data.x", "param.x" and "user" mean.
export const recordIdOf = (sources, req, body) => {
  for (const source of sources) {
    const [kind, name] = source.split(".");
    const value =
      kind === "user" ? req.user?.user_id
      : kind === "param" ? req.params?.[name]
      : kind === "data" ? body?.data?.[name]
      : undefined;

    if (value !== undefined && value !== null && POSITIVE_ID.test(String(value)))
      return String(value);
  }

  return null;
};

// Records, in sec.us07_audit_logs, every successful request that creates,
// changes or deletes something and is listed in AUDITED_ROUTES.
//
// It runs after the response has gone, so the person never waits for it, and it
// can never turn a request that worked into an error. A row that could not be
// written is reported to the console and nowhere else: the action has already
// happened, and undoing it because the log failed would be worse.
//
// Only requests that succeeded are recorded. The Audit Trail page says so too
// (it answers every row as SUCCESS).
export const createAuditTrail = ({
  getPool,
  insertAuditLog,
  apiPrefix = API_PREFIX,
  logError = console.error,
}) => {
  // Said once per person, not once per request.
  const withoutSession = new Set();

  const record = async (req, res) => {
    if (res.statusCode >= 400) return;

    const key = routeKeyOf(req, apiPrefix);
    const entry = key && AUDITED_ROUTES[key];
    if (!entry) return;

    const userId = req.user?.user_id;
    if (!userId) return;

    // A token from before sign-in opened sessions, or from a sign-in whose
    // session could not be opened. Every audit row names a session (the column
    // is required, and the DBA's procedure refuses one it does not know), so
    // there is nothing honest to write until they sign in again.
    const sessionId = req.user.session_id;
    if (!sessionId) {
      if (!withoutSession.has(userId)) {
        withoutSession.add(userId);
        logError(`Audit trail: user ${userId} has no session, so their actions are not recorded until they sign in again.`);
      }
      return;
    }

    const recordId = recordIdOf(entry.id, req, res.locals?.auditBody);
    if (!recordId) {
      logError(`Audit trail: no record id for ${key}, so the action was not recorded.`);
      return;
    }

    // A handler that knows what it changed leaves { object, oldValues, newValues } here
    // (res.locals.auditEntry). Every other route is written with the catalog's name and {}.
    const detail = res.locals?.auditEntry;

    await insertAuditLog(await getPool(), {
      userId,
      objectName: detail?.object ?? entry.object,
      recordId,
      action: entry.action,
      ipAddress: req.ip ? String(req.ip).slice(0, 45) : "unknown",
      sessionId,
      ...(detail && { oldValues: detail.oldValues, newValues: detail.newValues }),
    });
  };

  return (req, res, next) => {
    if (!MUTATING.has(req.method)) return next();

    // The id of something just created is only in the response.
    const sendJson = res.json.bind(res);
    res.json = (body) => {
      res.locals.auditBody = body;
      return sendJson(body);
    };

    res.on("finish", () => {
      record(req, res).catch((error) => logError(`Audit trail: could not record ${req.method} ${req.originalUrl}:`, error));
    });

    next();
  };
};

export const auditTrail = createAuditTrail({
  getPool,
  insertAuditLog: AuditTrailModel.insertAuditLog,
});

export default auditTrail;
