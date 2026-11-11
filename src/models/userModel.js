import { sql } from '../config/db.js';

const createUser = async (pool, userData) => {
    const result = await pool.request()
    .input('us01_username', sql.VarChar, userData.us01_username)
    .input('us01_password', sql.VarChar, userData.us01_password)
    .input('us01_first_name', sql.VarChar, userData.us01_first_name)
    .input('us01_middle_name', sql.VarChar, userData.us01_middle_name)
    .input('us01_last_name', sql.VarChar, userData.us01_last_name)
    .input('us01_email_address', sql.VarChar, userData.us01_email_address)
    .input('us01_created_by', sql.VarChar, userData.us01_created_by)
    .input("us01_must_change_password", sql.Bit, userData.us01_must_change_password)
    .input('client_id', sql.BigInt, userData.client_id)
    .output('us01_user_id', sql.BigInt)
    .execute('sec.us01_usp_ins_users')

    return result.output.us01_user_id
};

const assignRole = async (pool, userId, assignRoleData) => {
    await pool.request()
    .input('us01_user_id', sql.BigInt, userId)
    .input('us02_role_id', sql.BigInt, assignRoleData.us02_role_id)
    .input('us04_assigned_by', sql.VarChar, assignRoleData.us04_assigned_by)
    .execute('sec.us04_usp_assign_role')
};

const findUserByUsername = async (pool, username) => {
    const result = await pool.request()
    .input('us01_username', sql.VarChar, username)
    .execute('sec.us01_usp_login');

    return result.recordset[0];
};

const findUserById = async (pool, userId) => {
    const result = await pool.request()
    .input('us01_user_id', sql.BigInt, userId)
    .execute('sec.us01_usp_sel_user_by_id');

    return result.recordset[0];
};

// The output parameter is declared because the procedure requires it, and the
// value it carries is ignored because it means nothing. Those are two separate
// facts and PR #90 collapsed them into one, which broke every forced password
// change on main until 2026-09-08.
//
// sec.us01_usp_first_login declares `@us01_user_id bigint output` with no
// default. **An OUTPUT parameter without a default is mandatory** — SQL Server
// refuses the call outright with error 201, "expects parameter '@us01_user_id',
// which was not supplied", before a line of the body runs. So the parameter has
// to be supplied whether or not anybody wants what comes back.
//
// What comes back is nothing useful, and that half of PR #90 was right and
// stands. Nothing inside the procedure assigns it; it is echoed into the final
// SELECT and arrives NULL. The id is already in hand anyway — passwordService
// calls findUserByUsername immediately above this and that row carries
// us01_user_id, the same value the JWT is built from.
//
// So: declare it, and still return nothing. Returning it would restore the
// original trap, where `const userId = await UserModel.changePassword(...)`
// reads null with no error and no throw — the shape of the PR #77 bug.
//
// → If the parameter is ever dropped from the procedure, or given a default,
//   this line can go. That is `DBA-REQUESTS.md` item 14.
const changePassword = async (pool, userData) => {
    await pool.request()
    .input('us01_username', sql.VarChar, userData.us01_username)
    .input('oldpass', sql.VarChar, userData.oldpass)
    .input('newpass', sql.VarChar, userData.newpass)
    .output('us01_user_id', sql.BigInt)
    .execute('sec.us01_usp_first_login')
};

// After a wrong password. sec.us01_usp_login_failed, DBA request 18, read back
// 2026-10-06: it adds one to the count, locks the account for @lock_minutes
// once the count reaches @max_attempts, and starts the count again at 1 when an
// earlier lock has expired. It answers the new count and the seconds left on
// the lock, worked out against the database's own clock.
//
// No output parameters. All three are plain inputs, read from sys.parameters
// on the same day, so the item 14 trap is not here.
const recordFailedLogin = async (pool, userId, { maxAttempts, lockMinutes }) => {
    const result = await pool.request()
    .input('us01_user_id', sql.BigInt, userId)
    .input('max_attempts', sql.Int, maxAttempts)
    .input('lock_minutes', sql.Int, lockMinutes)
    .execute('sec.us01_usp_login_failed');

    return result.recordset[0];
};

// After a successful sign-in or password change: the count goes to 0, the lock
// is cleared, and the login is recorded. It replaces a raw UPDATE that set
// us01_last_login alone, which would have left a failed count standing after
// the person had proved their password.
const recordSuccessfulLogin = async (pool, userId) => {
    await pool.request()
    .input('us01_user_id', sql.BigInt, userId)
    .execute('sec.us01_usp_login_succeeded');
};

// Every token issued to this user before the call stops working: it raises
// us01_token_version, which verifySession checks on every request.
// sec.us01_usp_end_sessions, DBA request 18, read back 2026-10-06. One plain
// input, no output.
const endSessions = async (pool, userId) => {
    await pool.request()
    .input('us01_user_id', sql.BigInt, userId)
    .execute('sec.us01_usp_end_sessions');
};

// The active account of a client record: id, username, email and name, no
// password columns. sec.usp_sel_user_by_client_id, read on UAT 2026-11-11, is
// the raw query this used to be, word for word: those five columns, WHERE
// client_id = @client_id AND us01_is_active = 1.
const findUserByClientId = async (pool, clientId) => {
  const result = await pool
    .request()
    .input("client_id", sql.BigInt, clientId)
    .execute("sec.usp_sel_user_by_client_id");

  return result.recordset[0];
};

// An HR person enrolling themselves (DBA request 31): links the client record
// the enrollment just made to their HR account, instead of making a second
// account. The account is the active, unlocked HR account of this company
// whose email is the invitation's. Run inside the enrollment's transaction;
// the procedure opens none.
//
// Answers the account's id, or null when no HR account matches. Since request
// 31 it THROWs 50222 for an HR account already linked to another client
// record; before it, it kept the older link silently and still answered the id.
const linkHrClient = async (pool, { clientId, emailAddress, employerId, linkedBy }) => {
  const result = await pool
    .request()
    .input("client_id", sql.BigInt, clientId)
    .input("email_address", sql.VarChar(150), emailAddress)
    .input("employer_id", sql.BigInt, employerId)
    .input("linked_by", sql.VarChar(50), linkedBy)
    .execute("sec.us01_usp_link_hr_client");

  return result.recordset[0]?.us01_user_id ?? null;
};

// Issues a new temporary password. us01_usp_first_login cannot: it requires
// the old password, which is exactly what has been lost, and us01_usp_upd_user
// does not touch credentials. sec.usp_upd_user_password_reset does, read on
// UAT 2026-11-11 (DBA-PROCEDURES.md). It is the raw UPDATE this used to be,
// with the same SET list, and it answers one row, affected_count, 0 when no
// active account matched.
//
// What that SET list must do, and why, so a later change to the procedure is
// checked against it. A fake pool cannot see inside a procedure, so this is
// proven by reading its text, not by a test here.
//
// The lock and the failed-attempt counter are cleared alongside the password.
// Since PR #58 those two block a login, so leaving them set would hand the
// employee a working password and still refuse them at the door — with
// everything appearing to have worked. The temporary lock from DBA request 18
// is cleared for the same reason, which also makes this HR's way to unlock
// somebody at once rather than in fifteen minutes.
//
// The token version goes up in the same statement, so every session the
// employee had ends with the old password. Whoever was using those
// credentials is signed out. In the same UPDATE rather than a call to
// endSessions, so the two cannot come apart.
//
// And us01_must_change_password goes back to 1, so the temporary password
// has to be changed on first sign-in, and the reset token it leads to is
// single-use (PR #160).
const resetPassword = async (pool, resetData) => {
  const result = await pool
    .request()
    .input("us01_user_id", sql.BigInt, resetData.us01_user_id)
    .input("us01_password", sql.VarChar(255), resetData.us01_password)
    .input("us01_modified_by", sql.VarChar(50), resetData.us01_modified_by)
    .execute("sec.usp_upd_user_password_reset");

  return result.recordset[0]?.affected_count ?? 0;
};

// Keeps sec.us01_users in step with bes.clients after an approved change.
//
// The procedure COALESCEs every field, so NULL means "leave alone" rather than
// "clear". A middle name the employee cleared cannot be cleared here — see the
// note in the caller.
const updateUserRecord = async (pool, userData) => {
  const result = await pool
    .request()
    .input("us01_user_id", sql.BigInt, userData.us01_user_id)
    .input("us01_first_name", sql.VarChar(100), userData.us01_first_name)
    .input("us01_middle_name", sql.VarChar(100), userData.us01_middle_name)
    .input("us01_last_name", sql.VarChar(100), userData.us01_last_name)
    .input("us01_email_address", sql.VarChar(150), userData.us01_email_address)
    .input("us01_modified_by", sql.VarChar(50), userData.us01_modified_by)
    .execute("sec.us01_usp_upd_user");

  return result.recordset[0];
};

// sec.usp_sel_username_exists, read on UAT 2026-11-11: one row when the
// username is taken, active or not, none when it is free. Its parameter is
// nvarchar(50), the column's width.
const checkUsernameExists = async (pool, username) => {
    const result = await pool.request()
    .input('username', sql.NVarChar(50), username)
    .execute('sec.usp_sel_username_exists');

    return result.recordset.length > 0
}

export default {
    createUser,
    assignRole,
    findUserByUsername,
    findUserById,
    changePassword,
    recordFailedLogin,
    recordSuccessfulLogin,
    endSessions,
    checkUsernameExists,
    findUserByClientId,
    linkHrClient,
    updateUserRecord,
    resetPassword
}