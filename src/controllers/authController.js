import UserModel from "../models/userModel.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import config from "../config/env.js";
import {
  ADMIN,
  EMPLOYEE,
  REMEMBER_ME_EXPIRY,
  SESSION_EXPIRY,
  SUPER_ADMIN,
} from "../utils/constants.js";
import PasswordService from "../services/passwordService.js";
import { poolPromise } from "../config/db.js";
import { cookieOptions } from "../utils/cookieConfig.js";
import { AppError } from "../utils/AppError.js";

export const login = async (req, res, next) => {
  try {
    const pool = await poolPromise;

    const { username, password, rememberMe } = req.body;
    if (!username || !password)
      throw new AppError("All fields required", 400);

    const user = await UserModel.findUserByUsername(pool, username);
    if (!user) throw new AppError("Invalid Credentials", 401);

    const isPasswordMatched = await bcrypt.compare(
      password,
      user.us01_password,
    );
    if (!isPasswordMatched) throw new AppError("Invalid Credentials", 401);

    // Checked after the password on purpose. Only someone who already proved
    // they know the password learns the account exists but is closed, so this
    // tells an attacker nothing they did not already have.
    if (!user.us01_is_active || user.us01_is_locked)
      throw new AppError(
        "This account is no longer active. Please contact your HR.",
        403,
      );

    if (user.us02_role_name === EMPLOYEE)
      throw new AppError("Employees must use the employee login", 403);

    // The reset token is the whole answer here. Without it this response was a
    // dead end: the caller was told to change their password and given nothing
    // to change it with, and no session either, so a seeded HR account could
    // not be used at all.
    //
    // No `rememberMe` on this one. It is fifteen minutes whatever the caller
    // asked for, because it is a key to one action rather than a session.
    if (user.us01_must_change_password) {
      const changePasswordToken = jwt.sign(
        {
          user_id: user.us01_user_id,
          username: user.us01_username,
          purpose: "password_reset",
        },
        config.jwtSecret,
        { expiresIn: "15m" },
      );

      res.cookie("reset_token", changePasswordToken, {
        ...cookieOptions,
        maxAge: 15 * 60 * 1000,
      });

      return res.status(200).json({
        success: true,
        data: { mustChangePassword: true },
      });
    }

    const token = jwt.sign(
      {
        user_id: user.us01_user_id,
        username: user.us01_username,
        role_id: user.us02_role_id,
        role_name: user.us02_role_name,
      },
      config.jwtSecret,
      { expiresIn: rememberMe ? "30d" : "8h" },
    );

    res.cookie("token", token, {
      ...cookieOptions,
      maxAge: rememberMe ? REMEMBER_ME_EXPIRY : SESSION_EXPIRY,
    });

    await UserModel.updateLastLogin(pool, username);

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

    const pool = await poolPromise;

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
