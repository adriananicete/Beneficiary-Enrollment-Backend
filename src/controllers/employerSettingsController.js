import { getPool } from "../config/db.js";
import EmployerModel from "../models/employerModel.js";
import { AppError } from "../utils/AppError.js";

// Per-company settings, DBA request 19. One setting today: whether the
// Certificate of Coverage is attached to the emails sent automatically.
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
    const { send_coc_email } = req.body;

    // A real boolean and nothing else. The string "false" is truthy, and what
    // the driver makes of anything that is not a boolean is not something to
    // leave to chance on a setting a company asked for. Checked before the
    // database is touched.
    if (typeof send_coc_email !== "boolean")
      throw new AppError("send_coc_email must be true or false", 400);

    const pool = await getPool();

    const row = await EmployerModel.updateEmployerSettings(pool, {
      employerId: req.params.employer_id,
      sendCocEmail: send_coc_email,
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
