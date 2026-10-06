import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import UserModel from "../models/userModel.js";
import InvitationModel from "../models/invitationModel.js";
import config from "../config/env.js";
import { AppError } from "../utils/AppError.js";
import {
  EMPLOYEE,
  LOGIN_LOCK_MINUTES,
  LOGIN_MAX_ATTEMPTS,
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
const INVALID_CREDENTIALS = "Invalid Credentials";

// Compared against when the username does not exist, so an unknown username
// costs the same bcrypt work as a wrong password. Without it the unknown one
// answered about 70ms sooner, which is enough to tell from outside which
// usernames exist. Cost 10, the cost every password here is hashed at
// (enrollmentService, passwordService, adminController). The hash of a random
// string nobody kept; it matching anything would change nothing, because the
// caller is refused either way.
const DUMMY_HASH = "$2b$10$kgtjjJgo.H7JuZYmn5h56OKlKbIMApILa/jjc0wBL9NLt32zGDDZ2";

// sec.us01_usp_login THROWs 50037 for an unknown username rather than
// returning no row.
const UNKNOWN_USERNAME = 50037;

// The answer while an account is locked out. Only called with time left, and
// the minutes are rounded up, so the least it ever says is "1 minute".
const lockedOut = (secondsRemaining) => {
  const minutes = Math.ceil(secondsRemaining / 60);

  return new AppError(
    `Too many failed sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    429,
  );
};

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
// A JWT is signed at login and, on its own, is never re-checked: an account
// closed, locked or moved to another role afterwards would keep working until
// its token expired, up to thirty days with rememberMe. This is the check that
// stops it. GET /auth/me has asked it since 2026-09-23; since 2026-10-06
// verifyToken asks it on every authenticated request too, through
// verifySession below.
//
// Every refusal is 401, never 403. 401 means "this session is over, go and
// sign in", which is the only thing the frontend can usefully do with any of
// them; the login itself then says why.
//
// sec.us01_usp_sel_user_by_id, read 2026-09-23 and again 2026-10-06:
// - THROWs 50038 for a user who is inactive or does not exist. Mapped
//   globally to 403 for the endpoints that reach it; answered 401 here.
// - INNER JOINs an active role, so a user whose role was withdrawn comes back
//   as no row at all rather than as a row with a NULL role.
// - Does not check us01_is_locked. The login does, so this does too.
// - Returns us01_token_version since DBA request 18.
const activeUser = async (pool, session) => {
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

  return user;
};

// GET /auth/me: the account checks, then the profile.
const currentUser = async (pool, session) => {
  const user = await activeUser(pool, session);

  // An employee is never mapped to an employer in sec.us08_user_employer, so
  // the question is not asked for one.
  const employers =
    user.us02_role_name === EMPLOYEE
      ? []
      : await InvitationModel.getEmployersByUser(pool, user.us01_user_id);

  return profileOf(user, employers);
};

// Every authenticated request, from verifyToken: the account checks, and the
// token version. Session revocation, DBA request 18.
//
// The version goes up on logout, on a password change and when HR reissues
// credentials, and every token signed before that stops here. A token with no
// version at all was signed before this existed, and is refused the same way,
// so every session in place on deploy day ends once. So is a reset token, which
// never carries one.
//
// The temporary lockout does not raise it, deliberately. Anybody can trigger
// that lock with eight wrong passwords, and if it ended sessions, anybody could
// sign out any employee at will.
const verifySession = async (pool, session) => {
  const user = await activeUser(pool, session);

  if (session.token_version !== user.us01_token_version)
    throw new AppError(SESSION_ENDED, 401);

  return user;
};

// Signs the caller out on every device, by raising the version their tokens
// were signed with. Only a session that is still live can do that. A stale
// token, one already revoked, verifies as a JWT for up to thirty days; if it
// could raise the version, whoever held it could sign its owner out of every
// new session, again and again. So it is checked first, and a 401 from that
// check ends nothing.
const logout = async (pool, token) => {
  let session;

  try {
    session = jwt.verify(token, config.jwtSecret);
  } catch {
    return;
  }

  try {
    await verifySession(pool, session);
  } catch (error) {
    if (error.statusCode === 401) return;
    throw error;
  }

  await UserModel.endSessions(pool, session.user_id);
};

const login = async (
  pool,
  { username, password, rememberMe = false, allowedRoles, wrongDoorMessage },
) => {
  // Text only. Neither login route has a body validator, so the caller's JSON
  // arrives here as sent. bcrypt.compare throws on anything that is not a
  // string, and that throw is not an AppError, so a number or an object for a
  // password answered 500. Refused before the procedure is called, so an
  // object never reaches the driver as a username either.
  if (
    typeof username !== "string" || !username ||
    typeof password !== "string" || !password
  )
    throw new AppError("All fields required", 400);

  // An unknown username has to be indistinguishable from a wrong password, in
  // the message and in the time it takes, or this endpoint tells anybody which
  // usernames exist.
  //
  // It was not, in two ways, found 2026-10-06. The procedure THROWs 50037 for
  // an unknown username, and that went to errorHandler and was answered with
  // the map's "Invalid credentials" (small c), not this file's "Invalid
  // Credentials". And it skipped bcrypt, so it answered sooner. The test that
  // claimed the two were indistinguishable gave the fake pool an empty result
  // for the unknown user, which the real procedure never returns.
  let user;

  try {
    user = await UserModel.findUserByUsername(pool, username);
  } catch (error) {
    if ((error.number ?? error.originalError?.number) !== UNKNOWN_USERNAME)
      throw error;
  }

  if (!user) {
    await bcrypt.compare(password, DUMMY_HASH);
    throw new AppError(INVALID_CREDENTIALS, 401);
  }

  // The lockout, DBA request 18. Checked BEFORE the password, and that order is
  // the whole lock: checked after, a caller would still learn which guess was
  // right while the account was locked, and the lock would slow nothing down.
  // The cost is that a locked account answers differently from a missing one,
  // so it shows the account exists. Accepted 2026-10-06; usernames are
  // guessable anyway.
  //
  // The procedure works out the seconds left against its own clock. GETDATE()
  // is local time and the driver labels it UTC, so comparing us01_locked_until
  // with Date.now() here would be eight hours off.
  if (user.lock_seconds_remaining > 0)
    throw lockedOut(user.lock_seconds_remaining);

  const isPasswordMatch = await bcrypt.compare(password, user.us01_password);

  if (!isPasswordMatch) {
    // Only an account that exists can be locked. sec.us01_usp_login throws
    // 50037 for an unknown username before this line, so nothing is recorded
    // for one.
    const after = await UserModel.recordFailedLogin(pool, user.us01_user_id, {
      maxAttempts: LOGIN_MAX_ATTEMPTS,
      lockMinutes: LOGIN_LOCK_MINUTES,
    });

    // The attempt that reaches the limit says so, rather than answering
    // "Invalid Credentials" and leaving the next attempt to explain a lock.
    if (after?.lock_seconds_remaining > 0)
      throw lockedOut(after.lock_seconds_remaining);

    throw new AppError(INVALID_CREDENTIALS, 401);
  }

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
  //
  // recordSuccessfulLogin is not called on this path. It would set
  // us01_last_login for somebody who has not got in yet. The failed count is
  // reset when the password change succeeds instead.
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
      // Checked by verifySession on every request. From sec.us01_usp_login,
      // the same row the password was checked against.
      token_version: user.us01_token_version,
    },
    config.jwtSecret,
    { expiresIn: asSeconds(maxAge) },
  );

  // Clears the failed count and any expired lock, and records the login.
  await UserModel.recordSuccessfulLogin(pool, user.us01_user_id);

  return { mustChangePassword: false, token, maxAge, user: profile };
};

export default { login, currentUser, verifySession, logout };
