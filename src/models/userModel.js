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
    .execute('sec.us01_usp_sel_user_by_username');

    return result.recordset[0];
};

const findUserById = async (pool, userId) => {
    const result = await pool.request()
    .input('us01_user_id', sql.BigInt, userId)
    .execute('sec.us01_usp_sel_user_by_id');

    return result.recordset[0];
};

const updateUser = async (pool, userData) => {
    
};

export default {
    createUser,
    assignRole,
    findUserByUsername,
    findUserById
}