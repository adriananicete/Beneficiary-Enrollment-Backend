import { getPool } from "../config/db.js";
import EmployerModel from "../models/employerModel.js";

const isEnabled = (value) =>
  value === true || value === 1 || value === "1";

export const createGetMessagingAvailability = ({
  getPool,
  getMessagingAccessByUser,
}) => async (req, res, next) => {
  try {
    const pool = await getPool();
    const companies = await getMessagingAccessByUser(pool, req.user.user_id);

    return res.status(200).json({
      success: true,
      data: { enabled: companies.some((company) => isEnabled(company.messages_enabled)) },
    });
  } catch (error) {
    next(error);
  }
};

export const getMessagingAvailability = createGetMessagingAvailability({
  getPool,
  getMessagingAccessByUser: EmployerModel.getMessagingAccessByUser,
});
