import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import UserModel from "../models/userModel.js";
import InvitationModel from "../models/invitationModel.js";
import config from "../config/env.js";
import { AppError } from "../utils/AppError.js";
import {
  EMPLOYEE,
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

const ACCOUNT_CLOSED = "This account is no longer active. Please contact your HR.";
const SESSION_ENDED = "Your session has ended. Please sign in again.";

// What the frontend is told about the person signed in. Named field by field
// rather than spread from the row, because the row carries `us01_password`:
// sec.us01_usp_sel_user_by_id returns the hash with everything else, and a
// spread would send it to the browser the day nobody was looking. A column the
// procedure gains later stays out until somebody adds it here on purpose.
//
// `employers` is the company scope from sec.us08_user_employer. For HR that is
// their company. For an Administrator it is whatever mappings exist, normally
// none — their scope is every company whatever this says. The employee's own
// company is in GET /employee/enrollment and is not repeated here.
const profileOf = (user, employers) => ({
  user_id: user.us01_user_id,
  username: user.us01_username,
  role_id: user.us02_role_id,
  role_name: user.us02_role_name,
  first_name: user.us01_first_name,
  middle_name: user.us01_middle_name,
  last_name: user.us01_last_name,
  email_address: user.us01_email_address,
  client_id: user.client_id ?? null,
  employers: employers.map(({ employer_id, company_code, company_name }) => ({
    employer_id,
    company_code,
    company_name,
  })),
});

// Who a session belongs to, read from the database rather than from the token.
//
// That is the reason this exists alongside the JWT and not instead of reading
// it. The token is signed at login and nothing re-checks it: an account closed,
// locked or moved to another role afterwards keeps its token until it expires,
// up to thirty days with rememberMe. Every endpoint still trusts it — that is
// PARK.md §3 and is not changed here — but the screen that decides what the
// person sees now asks the database, so a closed account stops being shown a
// working dashboard.
//
// Every refusal is 401, never 403. For this endpoint 401 means "this session is
// over, go and sign in", which is the only thing the frontend can usefully do
// with any of them; the login itself then says why.
//
// sec.us01_usp_sel_user_by_id, read 2026-09-23:
// - THROWs 50038 for a user who is inactive or does not exist. Mapped
//   globally to 403 for the endpoints that reach it; answered 401 here.
// - INNER JOINs an active role, so a user whose role was withdrawn comes back
//   as no row at all rather than as a row with a NULL role.
// - Does not check us01_is_locked. The login does, so this does too.
const currentUser = async (pool, session) => {
  let user;

  try {
    user = await UserModel.findUserById(pool, session.user_id);
  } catch (error) {
    if ((error.number ?? error.originalError?.number) === 50038)
      throw new AppError(ACCOUNT_CLOSED, 401);
    throw error;
  }

  if (!user) throw new AppError(SESSION_ENDED, 401);

  if (!user.us01_is_active || user.us01_is_locked)
    throw new AppError(ACCOUNT_CLOSED, 401);

  // The token says what the rest of the API will enforce. If the role has
  // changed since it was signed, showing the new role's screens would promise
  // access the API still refuses, or hide access it still grants — so the
  // session ends, and the next login signs a token that agrees.
  if (user.us02_role_name !== session.role_name)
    throw new AppError(SESSION_ENDED, 401);

  // An employee is never mapped to an employer in sec.us08_user_employer, so
  // the question is not asked for one.
  const employers =
    user.us02_role_name === EMPLOYEE
      ? []
      : await InvitationModel.getEmployersByUser(pool, user.us01_user_id);

  return profileOf(user, employers);
};

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
    throw new AppError(ACCOUNT_CLOSED, 403);

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

  // The same answer GET /auth/me gives, so the frontend has one shape to read
  // and does not need a second request straight after signing in. Built before
  // the token is signed or the login recorded, so a failure here leaves no
  // trace of a login that did not complete.
  const profile = await currentUser(pool, {
    user_id: user.us01_user_id,
    role_name: user.us02_role_name,
  });

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

  return { mustChangePassword: false, token, maxAge, user: profile };
};

export default { login, currentUser };
