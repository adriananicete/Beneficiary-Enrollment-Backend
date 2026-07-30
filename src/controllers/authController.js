import UserModel from "../models/userModel.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import config from "../config/env.js";
import { REMEMBER_ME_EXPIRY, SESSION_EXPIRY } from "../utils/constants.js";
import { poolPromise } from "../config/db.js";

export const login = async (req, res, next) => {
  try {
    const pool = await poolPromise;

    const { username, password, rememberMe } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: "All fields required" });

    const user = await UserModel.findUserByUsername(pool, username);
    if (!user) return res.status(401).json({ error: "Invalid Credentials" });

    const isPasswordMatched = await bcrypt.compare(
      password,
      user.us01_password,
    );
    if (!isPasswordMatched)
      return res.status(401).json({ error: "Invalid Credentials" });

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
      httpOnly: true,
      secure: false,
      sameSite: "Strict",
      maxAge: rememberMe ? REMEMBER_ME_EXPIRY : SESSION_EXPIRY,
    });

    await UserModel.updateLastLogin(pool, username);

    return res.status(200).json({
      success: true,
      message: "Login successfully",
    });
  } catch (error) {
    if (error.originalError?.number === 50001)
      return res.status(401).json({ error: "Invalid credentials" });
    next(error);
  }
};

export const logout = (req, res, next) => {
  try {
    res.clearCookie("token", {
      httpOnly: true,
      secure: false,
      sameSite: "Strict",
    });

    return res.status(200).json({
      success: true,
      message: "Logout successful",
    });
  } catch (error) {
    next(error);
  }
};
