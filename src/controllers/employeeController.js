import ClientModel from "../models/clientModel.js";
import BeneficiaryModel from "../models/beneficiaryModel.js";
import AddressModel from "../models/addressModel.js";
import PasswordService from "../services/passwordService.js";
import AuthService from "../services/authService.js";
import { getPool } from "../config/db.js";
import { EMPLOYEE } from "../utils/constants.js";
import { cookieOptions } from "../utils/cookieConfig.js";

export const login = async (req, res, next) => {
  try {
    // See the note in authController: req.body is undefined when Express 5
    // parsed nothing, and this path used to reach bcrypt with an undefined
    // password, which throws and answers 500 rather than 400.
    const { username, password } = req.body ?? {};

    const pool = await getPool();

    // No `rememberMe`. The employee session has always been a fixed eight
    // hours, and the service defaults it off rather than reading it from a body
    // that could ask for thirty days.
    const result = await AuthService.login(pool, {
      username,
      password,
      allowedRoles: [EMPLOYEE],
      wrongDoorMessage: "Admin and HR must use the admin login",
    });

    if (result.mustChangePassword) {
      res.cookie("reset_token", result.resetToken, {
        ...cookieOptions,
        maxAge: result.maxAge,
      });

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

    const pool = await getPool();

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


export const changePassword = async (req, res, next) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const { username } = req.resetUser;

    const pool = await getPool();

    await PasswordService.changePassword(pool, {
      username,
      oldPassword,
      newPassword,
      allowedRoles: [EMPLOYEE],
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
