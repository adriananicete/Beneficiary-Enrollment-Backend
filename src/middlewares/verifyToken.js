import jwt from "jsonwebtoken";
import config from "../config/env.js";
import { AppError } from "../utils/AppError.js";
import { getPool } from "../config/db.js";
import AuthService from "../services/authService.js";
import { cookieOptions } from "../utils/cookieConfig.js";

// Built from its two dependencies so a test can hand it fakes; the app uses
// the real ones, below. A middleware cannot be given a pool by its caller,
// because Express is the caller.
export const createVerifyToken = ({ getPool, verifySession }) =>
  async (req, res, next) => {
    const { token } = req.cookies;

    if (!token)
      return next(new AppError("Unauthorized: No token provided.", 401));

    let decoded;

    try {
      decoded = jwt.verify(token, config.jwtSecret);
    } catch (error) {
      console.error(error);
      return next(new AppError("Invalid or expired token", 401));
    }

    // The signature proves the token was issued here. It does not prove the
    // session is still wanted. Until 2026-10-06 nothing else was asked, so a
    // logout, a password change or a closed account left the token working for
    // up to thirty days. verifySession asks the database: the account, its
    // role, and the token version that a logout raises. One read per request,
    // accepted for that.
    try {
      const pool = await getPool();
      await verifySession(pool, decoded);
    } catch (error) {
      // A 401 means the session is over, and the cookie goes with it. Anything
      // else, such as the database being unreachable, is passed on with the
      // cookie left alone, or one outage would sign everybody out.
      if (error.statusCode === 401) res.clearCookie("token", cookieOptions);
      return next(error);
    }

    req.user = decoded;

    next();
  };

export const verifyToken = createVerifyToken({
  getPool,
  verifySession: AuthService.verifySession,
});
