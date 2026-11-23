import { getPool } from "../config/db.js";
import EmploymentEndService from "../services/employmentEndService.js";
import { parseEmploymentEnd } from "../utils/employmentEnd.js";

// Ending an employee's employment, DBA request 39. Both routes sit behind
// verifyClientAccess, and the procedures scope again.

export const endEmployment = async (req, res, next) => {
  try {
    // The reason and the date, before the database is asked.
    const { reason, endDate } = parseEmploymentEnd(req.body);

    const pool = await getPool();

    const data = await EmploymentEndService.endEmployment(pool, {
      clientId: req.params.client_id,
      reason,
      endDate,
      userId: req.user.user_id,
    });

    // The audit row says what was recorded; the procedure writes none.
    res.locals.auditEntry = {
      newValues: {
        employment_end_reason: data.employment_end_reason,
        employment_end_date: data.employment_end_date,
        cancelled_requests: data.cancelled_requests,
      },
    };

    return res.status(200).json({ success: true, data, message: "Employment ended" });
  } catch (error) {
    next(error);
  }
};

// Administrator only. The route allows the Administrator alone; the procedure
// refuses anybody else as well (50246).
export const undoEmploymentEnd = async (req, res, next) => {
  try {
    const pool = await getPool();

    const data = await EmploymentEndService.undoEmploymentEnd(pool, {
      clientId: req.params.client_id,
      userId: req.user.user_id,
    });

    return res.status(200).json({ success: true, data, message: "Employment end undone" });
  } catch (error) {
    next(error);
  }
};
