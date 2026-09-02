import jwt from "jsonwebtoken";
import config from "../config/env.js";
import { AppError } from "../utils/AppError.js";

export const verifyToken = (req, res, next) => {
  const { token } = req.cookies;

  if (!token)
    return next(new AppError("Unauthorized: No token provided.", 401));

  try {
    const decoded = jwt.verify(token, config.jwtSecret);

    req.user = decoded;

    next();
  } catch (error) {
    console.error(error);
    return next(new AppError("Invalid or expired token", 401));
  }
};
