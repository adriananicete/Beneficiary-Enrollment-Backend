import bcrypt from "bcrypt";
import UserModel from "../models/userModel.js";
import { AppError } from "../utils/AppError.js";
import { validatePassword } from "../utils/validatePassword.js";
import { endUserSessions } from "../realtime/realtime.js";
import { NO_RECORD, SECURITY_EVENT } from "./securityEventService.js";

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
//
// `record` writes the security events (securityEventService.recorderFor). A
// new password refused by the policy is a form error, not a security event,
// and records nothing.
const changePassword = async (
  pool,
  { username, oldPassword, newPassword, allowedRoles, record = NO_RECORD },
) => {
  // oldPassword goes to bcrypt.compare, which throws on anything that is not a
  // string, and that answered 500. newPassword is not type-checked here:
  // validatePassword refuses it below with the rule, which says more.
  if (typeof oldPassword !== "string" || !oldPassword || !newPassword)
    throw new AppError("All fields required", 400);

  const user = await UserModel.findUserByUsername(pool, username);
  // Uniform message for both a missing user and a wrong password, so this
  // cannot be used to work out which usernames exist.
  if (!user) {
    record({ type: SECURITY_EVENT.PASSWORD_CHANGE_FAILED, username, detail: "unknown_username" });
    throw new AppError("Invalid Credentials", 400);
  }

  const who = { userId: user.us01_user_id, username };
  const failed = (detail) => record({ type: SECURITY_EVENT.PASSWORD_CHANGE_FAILED, ...who, detail });

  // The reset token is single-use. It is signed for one forced change, and
  // sec.us01_usp_first_login sets us01_must_change_password to 0 when that
  // change goes through, so spending the same token again inside its fifteen
  // minutes is refused here. The controller clears the cookie on success, but
  // the cookie is only the browser's copy: a token copied out of it could
  // otherwise change the password again for anyone who knew the new one.
  //
  // Checked before the password, so a spent token cannot be used to test
  // guesses at the current password either. Security controls list,
  // 2026-11-11.
  if (!user.us01_must_change_password) {
    record({ type: SECURITY_EVENT.RESET_TOKEN_REUSED, ...who });
    throw new AppError(
      "This password has already been changed. Please sign in again.",
      401,
    );
  }

  const isPasswordMatch = await bcrypt.compare(oldPassword, user.us01_password);
  if (!isPasswordMatch) {
    failed("wrong_password");
    throw new AppError("Invalid Credentials", 400);
  }

  // A reset token issued before the account was closed stays valid for its
  // full 15 minutes, so this path needs the same guard as the login.
  if (!user.us01_is_active || user.us01_is_locked) {
    failed("account_closed");
    throw new AppError(
      "This account is no longer active. Please contact your HR.",
      403,
    );
  }

  // Checked after the password for the same reason the logins check it there:
  // only someone who has already proved they know the password learns anything.
  if (!allowedRoles.includes(user.us02_role_name)) {
    failed("wrong_door");
    throw new AppError(
      "This account changes its password from its own sign-in page",
      403,
    );
  }

  if (oldPassword === newPassword)
    throw new AppError(
      "New password cannot be the same as the old password",
      400,
    );

  const passwordProblem = validatePassword(newPassword);
  if (passwordProblem) throw new AppError(passwordProblem, 400);

  const newHashPassword = await bcrypt.hash(newPassword, 10);

  // The procedure compares hashes, so `oldpass` has to be the stored hash
  // rather than what the caller typed. The real verification is the bcrypt
  // compare above.
  await UserModel.changePassword(pool, {
    us01_username: username,
    oldpass: user.us01_password,
    newpass: newHashPassword,
  });

  // The person has just proved their password, so the failed count goes to 0.
  // Without this, failures from before the change would still count against
  // them afterwards. That is the note DBA request 10 left for whoever built
  // lockout.
  await UserModel.recordSuccessfulLogin(pool, user.us01_user_id);

  // And every session signed with the old password ends, on every device. The
  // forced change is the only way a password changes here, so this is also the
  // path an employee takes after HR reissues their credentials.
  await UserModel.endSessions(pool, user.us01_user_id);

  // And any socket open with one of those sessions.
  endUserSessions(user.us01_user_id);

  record({ type: SECURITY_EVENT.PASSWORD_CHANGED, ...who });
};

export default {
  changePassword,
};
