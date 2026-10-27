import { getPool } from "../config/db.js";
import EmployerModel from "../models/employerModel.js";
import { SUPER_ADMIN } from "../utils/constants.js";
import { AppError } from "../utils/AppError.js";

// Per-company settings, DBA request 19. The settings include whether the
// Certificate of Coverage is attached to automatic emails and whether HR and
// employees can use in-app messaging.
// HR sees and changes their own company; the Administrator, every company.
// The procedures do that scoping, the same way usp_sel_hr_employee_by_client
// does, so nothing here decides who may see what.

// Named field by field rather than spread from the row, so a column the
// procedure gains later stays out until somebody adds it here on purpose.
export const settingsOf = (row) => ({
  employer_id: row.employer_id,
  company_code: row.company_code,
  company_name: row.company_name,
  send_coc_email: row.send_coc_email,
  messages_enabled: row.messages_enabled,
  modified_by: row.modified_by,
  modified_date: row.modified_date,
});

export const getEmployerSettings = async (req, res, next) => {
  try {
    const pool = await getPool();
    const rows = await EmployerModel.getEmployerSettings(pool, req.user.user_id);

    return res.status(200).json({
      success: true,
      data: rows.map(settingsOf),
    });
  } catch (error) {
    next(error);
  }
};

export const updateEmployerSettings = async (req, res, next) => {
  try {
    const { send_coc_email, messages_enabled } = req.body;

    if (send_coc_email === undefined && messages_enabled === undefined)
      throw new AppError("Send at least one company setting to update", 400);
    if (send_coc_email !== undefined && typeof send_coc_email !== "boolean")
      throw new AppError("send_coc_email must be true or false", 400);
    if (messages_enabled !== undefined && typeof messages_enabled !== "boolean")
      throw new AppError("messages_enabled must be true or false", 400);
    if (messages_enabled !== undefined && req.user.role_name !== SUPER_ADMIN)
      throw new AppError("Only the SuperAdmin can change the company messaging setting", 403);

    const pool = await getPool();

    const row = await EmployerModel.updateEmployerSettings(pool, {
      employerId: req.params.employer_id,
      sendCocEmail: send_coc_email ?? null,
      messagesEnabled: messages_enabled ?? null,
      userId: req.user.user_id,
    });

    return res.status(200).json({
      success: true,
      message: "Settings updated",
      data: settingsOf(row),
    });
  } catch (error) {
    next(error);
  }
};
