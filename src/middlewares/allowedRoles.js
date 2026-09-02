import { AppError } from "../utils/AppError.js";

export const allowedRoles = (...roles) => {
  return (req, res, next) => {
    const role_name = req.user?.role_name;

    if (!role_name) return next(new AppError("Unauthorized", 401));

    if (!roles.includes(role_name))
      return next(new AppError("Access Denied!", 403));

    next();
  };
};
