import { getPool } from "../config/db.js";
import AuditTrailService from "../services/auditTrailService.js";

// GET /api/v1/admin/audit-trail: the CRUD audit trail, newest first, for the
// Administrator (DBA request 34). The route lets only the Administrator in, and
// the procedure refuses anyone else again (50236 → 403). The answer is the
// paging envelope every list here uses.
export const createGetAuditTrail =
  ({ poolOf = getPool, list = AuditTrailService.listAuditLogs } = {}) =>
  async (req, res, next) => {
    try {
      const data = await list(await poolOf(), req.user.user_id, req.query);

      return res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  };

export const getAuditTrail = createGetAuditTrail();
