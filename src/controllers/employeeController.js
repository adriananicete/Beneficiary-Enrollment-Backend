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

export const login = async (req, res, next) => {
  try {
    const { username, password } = req.body;

    const pool = await poolPromise;

    const user = await UserModel.findUserByUsername(pool, username);

    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const isPasswordMatch = await bcrypt.compare(password, user.us01_password);
    if (!isPasswordMatch)
      return res.status(401).json({ error: "Invalid credentials" });

    if(user.us02_role_name !== EMPLOYEE) return res.status(403).json({error: 'Admin and HR must use the admin login'})

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

      return res.status(200).json({ mustChangePassword: true });
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
        message: "No Enrollment as of the moment",
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
      return res.status(404).json({ message: "Enrollment not found" });

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
      return res.status(400).json({ message: "All fields required" });

    const pool = await poolPromise;

    const user = await UserModel.findUserByUsername(pool, username);
    if (!user) return res.status(400).json({ error: "Invalid Credentials" });

    const isPasswordMatch = await bcrypt.compare(
      oldPassword,
      user.us01_password,
    );
    if (!isPasswordMatch) {
      return res.status(400).json({ message: "Invalid Credentials" });
    }

    if (oldPassword === newPassword) {
      return res.status(400).json({
        message: "New password cannot be the same as the old password",
      });
    }

    const passwordPolicy = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
    if (!passwordPolicy.test(newPassword)) {
      return res.status(400).json({
        message:
          "Password must be at least 8 characters and include a letter and a number",
      });
    }

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
