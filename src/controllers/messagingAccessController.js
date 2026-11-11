import { getPool } from "../config/db.js";
import EmployerModel from "../models/employerModel.js";
import { messagingAllowed } from "../utils/messagingAccess.js";

// GET /admin/messaging-access (HR) and GET /employee/messaging-access: whether
// to show messaging at all. The same rule as the gate in front of the
// conversation routes, so the chat is shown exactly when they would answer.
// Same shape as the teammates' version, { enabled }, which the frontend may
// already read.
export const getMessagingAccess = async (req, res, next) => {
  try {
    const pool = await getPool();
    const companies = await EmployerModel.getMessagingAccessByUser(pool, req.user.user_id);

    return res.status(200).json({
      success: true,
      data: { enabled: messagingAllowed(companies) },
    });
  } catch (error) {
    next(error);
  }
};

export default { getMessagingAccess };
