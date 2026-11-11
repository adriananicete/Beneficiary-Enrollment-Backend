import { getPool } from "../config/db.js";
import EmployerModel from "../models/employerModel.js";
import { AppError } from "../utils/AppError.js";
import { MESSAGING_OFF, messagingAllowed } from "../utils/messagingAccess.js";

// In front of every conversation route, HR's and the employee's. The company
// switch, bes.employers.messages_enabled, set by the Administrator. The rule is
// messagingAllowed's: every company of the caller has messaging on.
//
// The conversation procedures do not look at the switch themselves (UAT,
// 2026-11-11), so this is where it is enforced. They still do the scoping:
// another company's employee or conversation is 50171 or 50172 whatever this
// says.
//
// It costs a query, so on a route with a rate limiter it runs after it: a
// flood is refused before it reaches the database.
//
// Built from its dependencies so a test needs no database.
export const createRequireCompanyMessaging = ({
  loadPool = getPool,
  loadAccess = EmployerModel.getMessagingAccessByUser,
} = {}) => async (req, res, next) => {
  try {
    const pool = await loadPool();
    const companies = await loadAccess(pool, req.user.user_id);

    if (!messagingAllowed(companies)) throw new AppError(MESSAGING_OFF, 403);

    next();
  } catch (error) {
    next(error);
  }
};

export const requireCompanyMessaging = createRequireCompanyMessaging();

export default { requireCompanyMessaging, createRequireCompanyMessaging };
