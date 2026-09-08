import { ADMIN, SUPER_ADMIN } from "../utils/constants.js";
import AuthService from "../services/authService.js";
import PasswordService from "../services/passwordService.js";
import { getPool } from "../config/db.js";
import { cookieOptions } from "../utils/cookieConfig.js";

export const login = async (req, res, next) => {
  try {
    // Express 5 leaves req.body undefined when nothing was parsed, which is the
    // round-2 finding that broke the rate limiter's keyGenerator. Destructuring
    // it directly has the same exposure and would answer 500 where the guard
    // inside the service answers 400.
    const { username, password, rememberMe } = req.body ?? {};

    const pool = await getPool();

    const result = await AuthService.login(pool, {
      username,
      password,
      rememberMe,
      allowedRoles: [SUPER_ADMIN, ADMIN],
      wrongDoorMessage: "Employees must use the employee login",
    });

    if (result.mustChangePassword) {
      res.cookie("reset_token", result.resetToken, {
        ...cookieOptions,
        maxAge: result.maxAge,
      });

      // No session cookie on this path. That is the forced password change
      // doing its job, and it is the assertion worth keeping.
      return res.status(200).json({
        success: true,
        data: { mustChangePassword: true },
      });
    }

    res.cookie("token", result.token, {
      ...cookieOptions,
      maxAge: result.maxAge,
    });

    return res.status(200).json({
      success: true,
      message: "Login successfully",
    });
  } catch (error) {
    next(error);
  }
};

export const changePassword = async (req, res, next) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const { username } = req.resetUser;

    const pool = await getPool();

    await PasswordService.changePassword(pool, {
      username,
      oldPassword,
      newPassword,
      allowedRoles: [SUPER_ADMIN, ADMIN],
    });

    res.clearCookie("reset_token", cookieOptions);

    return res.status(200).json({
      success: true,
      message: "Password changed successfully",
    });
  } catch (error) {
    next(error);
  }
};

export const logout = (req, res, next) => {
  try {
    res.clearCookie("token", cookieOptions);

    return res.status(200).json({
      success: true,
      message: "Logout successful",
    });
  } catch (error) {
    next(error);
  }
};
