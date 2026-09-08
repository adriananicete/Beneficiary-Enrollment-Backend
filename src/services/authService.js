import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import UserModel from "../models/userModel.js";
import config from "../config/env.js";
import { AppError } from "../utils/AppError.js";
import {
  REMEMBER_ME_EXPIRY,
  RESET_TOKEN_EXPIRY,
  SESSION_EXPIRY,
} from "../utils/constants.js";

// One login flow reached from two doors, the same way `passwordService` is one
// forced-password-change reached from two. It was two copies that had already
// drifted: the admin login refused a request with no password and the employee
// login let it reach bcrypt, which throws on `undefined` and answered 500.
//
// Everything here decides; nothing here touches `res`. The caller sets the
// cookie and chooses the status code, because those are HTTP and this is not —
// and because a service that writes to a response cannot be tested without
// faking one.

// jwt takes seconds, cookies take milliseconds, and the two used to be written
// out separately — `expiresIn: "30d"` beside `maxAge: REMEMBER_ME_EXPIRY`.
//
// That mattered more than it looks. `PARK.md` §3 recommends shortening the
// rememberMe window as the first move against a session that outlives a closed
// account, and calls it "one constant in constants.js". Changing that constant
// alone would have expired the cookie sooner and left the token itself valid
// for thirty days — so the session would appear to end while anyone holding the
// token kept access. One source now, both derived.
const asSeconds = (ms) => Math.floor(ms / 1000);

const login = async (
  pool,
  { username, password, rememberMe = false, allowedRoles, wrongDoorMessage },
) => {
  if (!username || !password) throw new AppError("All fields required", 400);

  const user = await UserModel.findUserByUsername(pool, username);
  // Uniform message for a missing user and a wrong password, so this cannot be
  // used to work out which usernames exist.
  if (!user) throw new AppError("Invalid Credentials", 401);

  const isPasswordMatch = await bcrypt.compare(password, user.us01_password);
  if (!isPasswordMatch) throw new AppError("Invalid Credentials", 401);

  // Checked after the password on purpose. Only someone who already proved they
  // know the password learns the account exists but is closed, so this tells an
  // attacker nothing they did not already have.
  if (!user.us01_is_active || user.us01_is_locked)
    throw new AppError(
      "This account is no longer active. Please contact your HR.",
      403,
    );

  // An allowlist, where both controllers previously refused one role by name.
  // With three roles the two are equivalent; they stop being equivalent the day
  // a fourth is added, and an allowlist fails closed. It also matches the
  // `allowedRoles` middleware and `passwordService`, so the rule reads the same
  // way everywhere it is applied.
  if (!allowedRoles.includes(user.us02_role_name))
    throw new AppError(wrongDoorMessage, 403);

  // The reset token is the whole answer here. Without it this response was a
  // dead end: the caller was told to change their password and given nothing to
  // change it with, and no session either, so a seeded HR account could not be
  // used at all.
  //
  // No `rememberMe` on this one, and no session token either. Fifteen minutes
  // whatever the caller asked for, because it is a key to one action.
  if (user.us01_must_change_password) {
    const resetToken = jwt.sign(
      {
        user_id: user.us01_user_id,
        username: user.us01_username,
        purpose: "password_reset",
      },
      config.jwtSecret,
      { expiresIn: asSeconds(RESET_TOKEN_EXPIRY) },
    );

    return {
      mustChangePassword: true,
      resetToken,
      maxAge: RESET_TOKEN_EXPIRY,
    };
  }

  const maxAge = rememberMe ? REMEMBER_ME_EXPIRY : SESSION_EXPIRY;

  const token = jwt.sign(
    {
      user_id: user.us01_user_id,
      username: user.us01_username,
      role_id: user.us02_role_id,
      role_name: user.us02_role_name,
    },
    config.jwtSecret,
    { expiresIn: asSeconds(maxAge) },
  );

  await UserModel.updateLastLogin(pool, username);

  return { mustChangePassword: false, token, maxAge };
};

export default { login };
