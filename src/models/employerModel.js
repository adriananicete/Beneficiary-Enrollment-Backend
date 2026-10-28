import { sql } from '../config/db.js';

// The employee's affiliate is kept on the employment record (DBA request 25):
// it is the invitation's, never the form's. NULL is the company itself, and
// the procedure's default, so an older caller without it still works.
const insertClientEmployer = async (pool, clientEmployerData) => {
    const result =  await pool.request()
    .input('client_id', sql.BigInt, clientEmployerData.client_id)
    .input('employer_id', sql.BigInt, clientEmployerData.employer_id)
    .input('position_title', sql.VarChar, clientEmployerData.position_title)
    .input('is_current', sql.Bit, clientEmployerData.is_current)
    .input('created_by', sql.VarChar, clientEmployerData.created_by)
    .input('affiliate_id', sql.BigInt, clientEmployerData.affiliate_id ?? null)
    .output('client_employer_id', sql.BigInt)
    .execute('bes.usp_ins_client_employer')

    return result.output.client_employer_id;
};

// The per-company settings, DBA request 19, read back 2026-10-06. One setting
// today: whether the Certificate of Coverage is attached to the emails sent
// automatically. None of the three procedures has an output parameter.

// The setting for a client's current company. One row, or none when the
// client has no current company.
const getCocEmailSetting = async (pool, clientId) => {
    const result = await pool.request()
    .input('client_id', sql.BigInt, clientId)
    .execute('bes.usp_sel_coc_email_by_client');

    return result.recordset[0];
};

// The companies the caller may see and change: HR their own, the
// Administrator every active one. The procedure does the scoping.
const getEmployerSettings = async (pool, userId) => {
    const result = await pool.request()
    .input('us01_user_id', sql.BigInt, userId)
    .execute('bes.usp_sel_employer_settings');

    return result.recordset;
};

// Companies the signed-in employee or HR account can message. The procedure
// returns one row per company with its current setting; an employee gets their
// current company and HR gets its mapped company or companies.
const getMessagingAccessByUser = async (pool, userId) => {
    const result = await pool.request()
    .input('us01_user_id', sql.BigInt, userId)
    .execute('bes.usp_sel_messaging_access_by_user');

    return result.recordset;
};

// THROWs 50140 for a company that does not exist or is inactive, and 50141
// for HR changing a company that is not theirs. Answers the updated row.
const updateEmployerSettings = async (pool, { employerId, sendCocEmail, messagesEnabled, userId }) => {
    const result = await pool.request()
    .input('employer_id', sql.BigInt, employerId)
    .input('send_coc_email', sql.Bit, sendCocEmail)
    .input('messages_enabled', sql.Bit, messagesEnabled)
    .input('us01_user_id', sql.BigInt, userId)
    .execute('bes.usp_upd_employer_settings');

    return result.recordset[0];
};

export default {
    insertClientEmployer,
    getCocEmailSetting,
    getEmployerSettings,
    getMessagingAccessByUser,
    updateEmployerSettings,
};