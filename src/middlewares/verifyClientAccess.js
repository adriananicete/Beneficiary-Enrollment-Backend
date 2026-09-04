import { AppError } from "../utils/AppError.js";
import { ADMIN, SUPER_ADMIN } from "../utils/constants.js";
import ClientModel from "../models/clientModel.js";
import { isNumericId } from "./validateIdParam.js";
import { poolPromise } from "../config/db.js";

export const verifyClientAccess = async (req, res, next) => {
  try {
    const pool = await poolPromise;
    const { role_name, user_id } = req.user;
    const { client_id } = req.params;

    // Checked before the id goes anywhere near the driver, and before the role
    // branches, so both roles get the same answer. The rule itself lives in
    // validateIdParam.js, which is also the middleware the change request
    // routes use — this one stays inline so that any future route added behind
    // verifyClientAccess is covered without having to remember a second
    // middleware.
    if(!isNumericId(client_id))
      throw new AppError('Enrollment not found', 404);

    if(role_name === SUPER_ADMIN) return next();
    if(role_name === ADMIN) {
        // One row, or none. This used to load every employee in the company to
        // check a single id — on every request to every admin enrollment route.
        //
        // It was also a trap waiting for the enrollment list to be paged: the
        // moment usp_sel_hr_employees returned a page rather than everything,
        // this check would have stopped seeing employees that exist and refused
        // legitimate HR with a 403. That is what happened to revoke and resend
        // when the invitation list was paged, caught before it shipped.
        const employee = await ClientModel.getHrEmployeeByClient(pool, user_id, client_id);

        if(!employee) throw new AppError('Forbidden', 403);

        return next()
    }

    throw new AppError('Unauthorized', 401);
  } catch (error) {
    next(error)
  }
};
