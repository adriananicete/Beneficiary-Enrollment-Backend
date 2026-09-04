import bcrypt from "bcrypt";
import UserModel from "../models/userModel.js";
import { AppError } from "../utils/AppError.js";

// The forced password change is one flow reached from two logins, so it is one
// implementation. It was employee-only until now, which is why an HR or admin
// account with the flag set could log in, be told to change its password, and
// have nowhere to go.
//
// `allowedRoles` mirrors the middleware of the same name. Both logins guard
// their own role and this is the door behind both of them; a rule enforced on
// one side and not the other stops being a rule.
//
// The role is read from the user row rather than carried in the reset token.
// The row is already being fetched to check the password, so the check costs
// nothing, and a role that changed inside the token's fifteen minutes resolves
// the database's way rather than the way it looked when the token was minted.
const changePassword = async (
  pool,
  { username, oldPassword, newPassword, allowedRoles },
) => {
  if (!oldPassword || !newPassword)
    throw new AppError("All fields required", 400);

  const user = await UserModel.findUserByUsername(pool, username);
  // Uniform message for both a missing user and a wrong password, so this
  // cannot be used to work out which usernames exist.
  if (!user) throw new AppError("Invalid Credentials", 400);

  const isPasswordMatch = await bcrypt.compare(oldPassword, user.us01_password);
  if (!isPasswordMatch) throw new AppError("Invalid Credentials", 400);

  // A reset token issued before the account was closed stays valid for its
  // full 15 minutes, so this path needs the same guard as the login.
  if (!user.us01_is_active || user.us01_is_locked)
    throw new AppError(
      "This account is no longer active. Please contact your HR.",
      403,
    );

  // Checked after the password for the same reason the logins check it there:
  // only someone who has already proved they know the password learns anything.
  if (!allowedRoles.includes(user.us02_role_name))
    throw new AppError(
      "This account changes its password from its own sign-in page",
      403,
    );

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

  // The procedure compares hashes, so `oldpass` has to be the stored hash
  // rather than what the caller typed. The real verification is the bcrypt
  // compare above.
  await UserModel.changePassword(pool, {
    us01_username: username,
    oldpass: user.us01_password,
    newpass: newHashPassword,
  });

  await UserModel.updateLastLogin(pool, username);
};

export default {
  changePassword,
};
