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
      data: { user: result.user },
    });
  } catch (error) {
    next(error);
  }
};

// GET /auth/me — who is signed in, for all three roles. The session cookie is
// httpOnly, so the frontend cannot read the token and has no other way to know
// after a page reload.
//
// A 401 from the lookup clears the cookie as well as answering. The token may
// still verify for days; the account behind it no longer does, and a cookie
// left in place would be sent, and refused, on every request after this one.
export const getMe = async (req, res, next) => {
  try {
    const pool = await getPool();
    const user = await AuthService.currentUser(pool, req.user);

    return res.status(200).json({
      success: true,
      data: { user },
    });
  } catch (error) {
    if (error.statusCode === 401) res.clearCookie("token", cookieOptions);
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
