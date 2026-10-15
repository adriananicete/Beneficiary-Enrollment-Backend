import { sql } from "../config/db.js";

// The Administrator's company procedures, DBA request 24, read back
// 2026-10-15. Every one takes the caller and refuses anybody who is not an
// active Administrator (50182). None has an OUTPUT parameter: the ids come back
// in a result set.
//
// Each text parameter is bound at the width the procedure declares. The code
// and the policy number are declared wider than their columns on purpose, so
// the procedure sees a value that is too long and refuses it rather than
// receiving it already cut.

const bindCompany = (request, company) =>
    request
    .input('company_code', sql.VarChar(50), company.company_code)
    .input('company_name', sql.VarChar(200), company.company_name)
    .input('work_address', sql.VarChar(255), company.work_address)
    .input('office_no', sql.VarChar(30), company.office_no)
    .input('policy_no', sql.NVarChar(50), company.policy_no)
    .input('send_coc_email', sql.Bit, company.send_coc_email)
    .input('online_enrollment_max_age', sql.Int, company.online_enrollment_max_age);

// Every company, any status, with its HR account and its counts.
const getCompanies = async (pool, userId) => {
    const result = await pool.request()
    .input('us01_user_id', sql.BigInt, userId)
    .execute('usp_sel_employers_admin');

    return result.recordset;
};

// One company, or undefined for an id that matches none.
const getCompanyById = async (pool, userId, employerId) => {
    const result = await pool.request()
    .input('us01_user_id', sql.BigInt, userId)
    .input('employer_id', sql.BigInt, employerId)
    .execute('usp_sel_employer_admin_by_id');

    return result.recordset[0];
};

// Also maps every active Administrator to the new company, in the same
// transaction. THROWs 50183–50186.
const createCompany = async (pool, userId, company) => {
    const result = await bindCompany(
        pool.request().input('us01_user_id', sql.BigInt, userId),
        company,
    )
    .input('created_by', sql.VarChar(50), String(userId))
    .execute('usp_ins_employer');

    return result.recordset[0].employer_id;
};

// Replaces every field as sent; the caller sends the whole company. THROWs
// 50183–50188.
const updateCompany = async (pool, userId, employerId, company) => {
    const result = await bindCompany(
        pool.request()
        .input('us01_user_id', sql.BigInt, userId)
        .input('employer_id', sql.BigInt, employerId),
        company,
    )
    .input('modified_by', sql.VarChar(50), String(userId))
    .execute('usp_upd_employer');

    return result.recordset[0].employer_id;
};

// Maps a new HR account to its company, inside our transaction with
// sec.us01_usp_ins_users and sec.us04_usp_assign_role. Opens no transaction.
// THROWs 50187 (company), 50196 (not an active HR user), 50197 (the company
// already has one).
const mapHrAccount = async (transaction, userId, { hrUserId, employerId }) => {
    await transaction.request()
    .input('us01_user_id', sql.BigInt, userId)
    .input('hr_us01_user_id', sql.BigInt, hrUserId)
    .input('employer_id', sql.BigInt, employerId)
    .input('us08_assigned_by', sql.VarChar(50), String(userId))
    .execute('sec.us08_usp_ins_user_employer');
};

// The company's HR account, for reissuing its password: id, username, name,
// email and state. No password columns. Undefined when there is none.
const getHrAccount = async (pool, userId, employerId) => {
    const result = await pool.request()
    .input('us01_user_id', sql.BigInt, userId)
    .input('employer_id', sql.BigInt, employerId)
    .execute('sec.us08_usp_sel_hr_by_employer');

    return result.recordset[0];
};

export default {
    getCompanies,
    getCompanyById,
    createCompany,
    updateCompany,
    mapHrAccount,
    getHrAccount,
};
