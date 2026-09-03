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

const changePassword = async (pool, userData) => {
    const result = await pool.request()
    .input('us01_username', sql.VarChar, userData.us01_username)
    .input('oldpass', sql.VarChar, userData.oldpass)
    .input('newpass', sql.VarChar, userData.newpass)
    .output('us01_user_id', sql.BigInt)
    .execute('sec.us01_usp_first_login')

    return result.output.us01_user_id;
};

const updateLastLogin = async (pool, username) => {
    const result = await pool.request()
    .input('us01_username', sql.VarChar, username)
    .query(`
        UPDATE sec.us01_users SET us01_last_login = GETDATE() WHERE us01_username = @us01_username
        `)
};

// Raw query, following updateLastLogin and checkUsernameExists below. There is
// no procedure that reaches a user by client_id, and this is a single column
// lookup on an indexed key.
const findUserIdByClientId = async (pool, clientId) => {
  const result = await pool
    .request()
    .input("client_id", sql.BigInt, clientId)
    .query(`SELECT us01_user_id FROM sec.us01_users
            WHERE client_id = @client_id AND us01_is_active = 1`);

  return result.recordset[0]?.us01_user_id;
};

// Keeps sec.us01_users in step with dbo.clients after an approved change.
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

const checkUsernameExists = async (pool, username) => {
    const result = await pool.request()
    .input('username', sql.NVarChar, username)
    .query(`SELECT 1 FROM sec.us01_users WHERE us01_username = @username`);

    return result.recordset.length > 0
}

export default {
    createUser,
    assignRole,
    findUserByUsername,
    findUserById,
    changePassword,
    updateLastLogin,
    checkUsernameExists,
    findUserIdByClientId,
    updateUserRecord
}