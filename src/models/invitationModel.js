import { sql } from '../config/db.js';

const getInvitationByToken = async (pool, token) => {
    const result = await pool.request()
    .input('token', sql.NVarChar(64), token)
    .execute('usp_sel_enrollment_invitation_by_token');

    return result.recordset[0];
};

// The five filters are all optional in the procedure, so an undefined here has
// to reach it as NULL rather than as a value. mssql sends undefined as NULL,
// but passing it explicitly says so out loud.
const getInvitationsByUser = async (pool, userId, filters = {}) => {
    const result = await pool.request()
    .input('us01_user_id', sql.BigInt, userId)
    .input('page', sql.Int, filters.page)
    .input('page_size', sql.Int, filters.pageSize)
    .input('is_enrolled', sql.Bit, filters.isEnrolled ?? null)
    .input('status', sql.VarChar(1), filters.status ?? null)
    .input('send_status', sql.VarChar(10), filters.sendStatus ?? null)
    .input('search', sql.VarChar(150), filters.search ?? null)
    .execute('usp_sel_enrollment_invitations_by_user')

    return result.recordset;
};

// Answers one question — does this invitation belong to this caller's company —
// rather than fetching the company to look the answer up in it. Applies the same
// scoping as usp_sel_enrollment_invitations_by_user.
//
// Returns the row or undefined. No rows is how "not yours" arrives: the
// procedure does not throw for it, so the caller decides what to say.
//
// It returns `token`, which the list deliberately does not. That is correct
// here — this row never leaves the server, and the resend path needs the token
// to rebuild the enrollment link.
const getInvitationById = async (pool, userId, invitationId) => {
    const result = await pool.request()
    .input('invitation_id', sql.BigInt, invitationId)
    .input('us01_user_id', sql.BigInt, userId)
    .execute('usp_sel_enrollment_invitation_by_id')

    return result.recordset[0];
};

const getEmployersByUser = async (pool, userId) => {
    const result = await pool.request()
    .input('us01_user_id', sql.BigInt, userId)
    .execute('sec.us08_usp_sel_employers_by_user')

    return result.recordset;
};

const createInvitation = async (pool, invitationData) => {
    const result = await pool.request()
    .input('employer_id', sql.BigInt, invitationData.employer_id)
    .input('email_address', sql.VarChar(150), invitationData.email_address)
    .input('token', sql.NVarChar(64), invitationData.token)
    .input('created_by', sql.VarChar(50), invitationData.created_by)
    .output('invitation_id', sql.BigInt)
    .execute('usp_ins_enrollment_invitation')

    return result.output.invitation_id
};

const revokeInvitation = async (pool, invitationId, modifiedBy) => {
    const result = await pool.request()
    .input('invitation_id', sql.BigInt, invitationId)
    .input('modified_by', sql.VarChar(50), modifiedBy)
    .execute('usp_del_enrollment_invitation')
};

const resendInvitation = async (pool, invitationId, modifiedBy) => {
    const result = await pool.request()
    .input('invitation_id', sql.BigInt, invitationId)
    .input('modified_by', sql.VarChar(50), modifiedBy)
    .execute('usp_upd_enrollment_invitation_resend')
};

const updateSendStatus = async (pool, invitationId, sendStatus, lastSendError, modifiedBy) => {
    const result = await pool.request()
    .input('invitation_id', sql.BigInt, invitationId)
    .input('send_status', sql.VarChar(20), sendStatus)
    .input('last_send_error', sql.VarChar(500), lastSendError)
    .input('modified_by', sql.VarChar(50), modifiedBy)
    .execute('usp_upd_enrollment_invitation_send_status')
};

export default {
    getInvitationByToken,
    getInvitationById,
    getInvitationsByUser,
    getEmployersByUser,
    createInvitation,
    revokeInvitation,
    resendInvitation,
    updateSendStatus
}