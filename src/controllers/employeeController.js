import UserModel from "../models/userModel.js";
import ClientModel from "../models/clientModel.js";
import EnrollmentService from "../services/enrollmentService.js";
import BeneficiaryModel from "../models/beneficiaryModel.js";
import AddressModel from "../models/addressModel.js";
import { poolPromise } from "../config/db.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import config from "../config/env.js";
import { EMPLOYEE, SESSION_EXPIRY } from "../utils/constants.js";
import { cookieOptions } from "../utils/cookieConfig.js";
import { AppError } from "../utils/AppError.js";

export const login = async (req, res, next) => {
  try {
    const { username, password } = req.body;

    const pool = await poolPromise;

    const user = await UserModel.findUserByUsername(pool, username);

    if (!user) throw new AppError("Invalid credentials", 401);

    const isPasswordMatch = await bcrypt.compare(password, user.us01_password);
    if (!isPasswordMatch) throw new AppError("Invalid credentials", 401);

    if (user.us02_role_name !== EMPLOYEE)
      throw new AppError("Admin and HR must use the admin login", 403);

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
      { expiresIn: "8h" },
    );

    res.cookie("token", token, {
      ...cookieOptions,
      maxAge: SESSION_EXPIRY,
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

export const logout = async (req, res, next) => {
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

export const getMyEnrollment = async (req, res, next) => {
  try {
    const { user_id } = req.user;

    const pool = await poolPromise;

    const enrollment = await ClientModel.getMyEnrollment(pool, user_id);
    if (enrollment.length === 0)
      return res.status(200).json({
        success: true,
        data: null,
        message: "No enrollment as of the moment",
      });

    const beneficiaries = await BeneficiaryModel.getBeneficiariesByEnrollmentId(
      pool,
      enrollment[0].enrollment_id,
    );

    const clientAddress = await AddressModel.getClientAddressId(
      pool,
      enrollment[0].client_id,
    );

    return res.status(200).json({
      success: true,
      data: { enrollment, clientAddress: clientAddress ?? null, beneficiaries },
    });
  } catch (error) {
    next(error);
  }
};

export const editMyEnrollment = async (req, res, next) => {
  try {
    const { user_id } = req.user;

    const pool = await poolPromise;

    const enrollment = await ClientModel.getMyEnrollment(pool, user_id);
    if (!enrollment || enrollment.length === 0)
      throw new AppError("Enrollment not found", 404);

    const { client_id } = enrollment[0];

    await EnrollmentService.updateEnrollment(user_id, {
      ...req.body,
      client_id,
    });

    return res.status(200).json({
      success: true,
      message: "Enrollment updated successfully",
    });
  } catch (error) {
    next(error);
  }
};

export const changePassword = async (req, res, next) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const { username } = req.resetUser;

    if (!oldPassword || !newPassword)
      throw new AppError("All fields required", 400);

    const pool = await poolPromise;

    const user = await UserModel.findUserByUsername(pool, username);
    // Uniform message for both a missing user and a wrong password, so this
    // cannot be used to work out which usernames exist.
    if (!user) throw new AppError("Invalid Credentials", 400);

    const isPasswordMatch = await bcrypt.compare(
      oldPassword,
      user.us01_password,
    );
    if (!isPasswordMatch) throw new AppError("Invalid Credentials", 400);

    if (oldPassword === newPassword)
      throw new AppError(
        "New password cannot be the same as the old password",
        400,
      );

    const passwordPolicy = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
    if (!passwordPolicy.test(newPassword))
      throw new AppError(
        "Password must be at least 8 characters and include a letter and a number",
        400,
      );

    const newHashPassword = await bcrypt.hash(newPassword, 10);

    await UserModel.changePassword(pool, {
      us01_username: username,
      oldpass: user.us01_password,
      newpass: newHashPassword,
    });

    await UserModel.updateLastLogin(pool, username);

    res.clearCookie("reset_token", cookieOptions);

    return res.status(200).json({
      success: true,
      message: "Password changed successfully",
    });
  } catch (error) {
    next(error);
  }
};
