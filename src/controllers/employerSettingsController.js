import { getPool } from "../config/db.js";
import EmployerModel from "../models/employerModel.js";
import EmployerSettingsService from "../services/employerSettingsService.js";
import { AppError } from "../utils/AppError.js";
import { SUPER_ADMIN } from "../utils/constants.js";
import { isOn } from "../utils/messagingAccess.js";

// Per-company settings. Two:
// - send_coc_email (DBA request 19): whether the Certificate of Coverage is
//   attached to the emails sent automatically. HR changes their own company's;
//   the Administrator, any company's.
// - messages_enabled: whether the company has messaging at all. Only the
//   Administrator changes it (Adrian, 2026-11-11).
// The procedures scope who sees which company, the same way
// usp_sel_hr_employee_by_client does. The Administrator-only rule for
// messaging is checked here, before the database, and again by the procedure
// as 50223 (DBA request 27 Part 2).

// Named field by field rather than spread from the row, so a column the
// procedure gains later stays out until somebody adds it here on purpose.
// messages_enabled is shown as the gate reads it: NULL is off.
export const settingsOf = (row) => ({
  employer_id: row.employer_id,
  company_code: row.company_code,
  company_name: row.company_name,
  send_coc_email: row.send_coc_email,
  messages_enabled: isOn(row.messages_enabled),
  modified_by: row.modified_by,
  modified_date: row.modified_date,
});

export const NO_SETTING = "Send send_coc_email, messages_enabled, or both, as true or false";
export const MESSAGING_ADMINISTRATOR_ONLY = "Only the Administrator can change the company messaging setting.";

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

    // Either setting, or both. A setting left out is kept as it is.
    if (send_coc_email === undefined && messages_enabled === undefined)
      throw new AppError(NO_SETTING, 400);

    // A real boolean and nothing else. The string "false" is truthy, and what
    // the driver makes of anything that is not a boolean is not something to
    // leave to chance on a setting a company asked for. Checked before the
    // database is touched.
    if (send_coc_email !== undefined && typeof send_coc_email !== "boolean")
      throw new AppError("send_coc_email must be true or false", 400);

    if (messages_enabled !== undefined && typeof messages_enabled !== "boolean")
      throw new AppError("messages_enabled must be true or false", 400);

    if (messages_enabled !== undefined && req.user.role_name !== SUPER_ADMIN)
      throw new AppError(MESSAGING_ADMINISTRATOR_ONLY, 403);

    const pool = await getPool();

    const row = await EmployerSettingsService.updateSettings(pool, {
      employerId: req.params.employer_id,
      sendCocEmail: send_coc_email,
      messagesEnabled: messages_enabled,
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
