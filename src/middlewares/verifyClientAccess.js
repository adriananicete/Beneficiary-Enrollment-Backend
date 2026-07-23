import { AppError } from "../utils/AppError.js";
import { ADMIN, SUPER_ADMIN } from "../utils/constants.js";
import ClientModel from "../models/clientModel.js";
import { poolPromise } from "../config/db.js";

export const verifyClientAccess = async (req, res, next) => {
  try {
    const pool = await poolPromise;
    const { role_name, user_id } = req.user;
    const { client_id } = req.params;

    if(role_name === SUPER_ADMIN) return next();
    if(role_name === ADMIN) {
        const hrEnrollmentData = await ClientModel.getHrEmployees(pool, user_id);

        const isAuthorized = hrEnrollmentData.some(emp => Number(emp.client_id) === Number(client_id)); 

        if(!isAuthorized) throw new AppError('Forbidden', 403);

        return next()
    }

    throw new AppError('Unauthorized', 401);
  } catch (error) {
    next(error)
  }
};
