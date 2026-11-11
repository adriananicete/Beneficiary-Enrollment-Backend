import { getPool } from "../config/db.js";
import { recordAuditEntry } from "../services/auditTrailService.js";
import { AUDITED_ROUTES } from "../utils/auditCatalog.js";

// Records, in the audit trail (DBA request 34), every request that succeeded
// and is listed in AUDITED_ROUTES. Ported from the teammates' middleware.
//
// Mounted once, before the routers. It writes after the answer has gone, so the
// caller never waits for it and it can never turn a request that worked into an
// error. Only requests that succeeded are recorded.
//
// The route and the answer's body are both taken when the handler answers
// (res.json): the body has the id of anything just created, which is why
// res.json is wrapped at all. The route is taken at the same moment. Express 5
// still has it on "finish" too (measured 2026-11-11), but reading it there
// would depend on what the router leaves on the request afterwards. A handler
// that knows what it changed leaves { object, oldValues, newValues } in
// res.locals.auditEntry.

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const API_PREFIX = "/api/v1";
const POSITIVE_ID = /^[1-9]\d*$/;

// The route as declared, under /api/v1: "PATCH /admin/companies/:employer_id".
export const routeKeyOf = (req, apiPrefix = API_PREFIX) => {
  if (typeof req.route?.path !== "string") return null;

  const path = `${req.baseUrl ?? ""}${req.route.path}`;
  return `${req.method} ${path.startsWith(apiPrefix) ? path.slice(apiPrefix.length) : path}`;
};

// The first source that gives a whole number above zero, or null. See
// AUDITED_ROUTES for what "data.x" and "param.x" mean.
export const recordIdOf = (sources, req, body) => {
  for (const source of sources) {
    const [kind, name] = source.split(".");
    const value = kind === "param" ? req.params?.[name] : kind === "data" ? body?.data?.[name] : undefined;

    if (value !== undefined && value !== null && POSITIVE_ID.test(String(value))) return String(value);
  }

  return null;
};

export const createAuditTrail =
  ({ poolOf = getPool, record = recordAuditEntry, catalog = AUDITED_ROUTES, apiPrefix = API_PREFIX } = {}) =>
  (req, res, next) => {
    if (!MUTATING.has(req.method)) return next();

    const sendJson = res.json.bind(res);
    res.json = (body) => {
      res.locals.auditKey = routeKeyOf(req, apiPrefix);
      res.locals.auditBody = body;
      return sendJson(body);
    };

    res.on("finish", () => {
      if (res.statusCode >= 400) return;

      const entry = catalog[res.locals.auditKey];
      const userId = req.user?.user_id;
      if (!entry || !userId) return;

      const detail = res.locals.auditEntry;

      void record(poolOf(), {
        userId,
        objectName: detail?.object ?? entry.object,
        recordId: recordIdOf(entry.id, req, res.locals.auditBody),
        action: entry.action,
        ipAddress: req.ip,
        oldValues: detail?.oldValues,
        newValues: detail?.newValues,
      });
    });

    next();
  };

export const auditTrail = createAuditTrail();

export default auditTrail;
