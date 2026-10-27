import { getPool } from "../config/db.js";
import EmployerModel from "../models/employerModel.js";
import { AppError } from "../utils/AppError.js";

const isOn = (value) => value === true || value === 1 || value === "1";

export const createRequireCompanyMessaging = ({
  loadPool = getPool,
  getMessagingAccessByUser = EmployerModel.getMessagingAccessByUser,
} = {}) => async (req, res, next) => {
  try {
    const pool = await loadPool();
    const rows = await getMessagingAccessByUser(pool, req.user.user_id);

    if (!rows.some((row) => isOn(row.messages_enabled)))
      throw new AppError("Messaging is disabled for this company.", 403);

    next();
  } catch (error) {
    next(error);
  }
};

export const requireCompanyMessaging = createRequireCompanyMessaging();

export default requireCompanyMessaging;
