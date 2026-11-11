import { getPool } from "../config/db.js";
import SecurityEventService from "../services/securityEventService.js";

// GET /api/v1/admin/security-events: the security log, newest first, for the
// Administrator (DBA request 28). The route lets only the Administrator in,
// and the procedure refuses anyone else again (50224 → 403). The answer is the
// paging envelope every list here uses.
export const createGetSecurityEvents =
  ({ poolOf = getPool, list = SecurityEventService.listSecurityEvents } = {}) =>
  async (req, res, next) => {
    try {
      const data = await list(await poolOf(), req.user.user_id, req.query);

      return res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  };

export const getSecurityEvents = createGetSecurityEvents();
