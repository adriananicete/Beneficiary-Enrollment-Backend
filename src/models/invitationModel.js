import { sql } from '../config/db.js';

const getInvitationByToken = async (pool, token) => {
    const result = await pool.request()
    .input('token', sql.NVarChar(64), token)
    .execute('usp_sel_enrollment_invitation_by_token');

    return result.recordset[0];
};

const getInvitationsByUser = async (pool, userId) => {
    const result = await pool.request()
    .input('us01_user_id', sql.BigInt, userId)
    .execute('usp_sel_enrollment_invitations_by_user')

    return result.recordset;
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

export default {
    getInvitationByToken,
    getInvitationsByUser,
    getEmployersByUser,
    createInvitation,
    revokeInvitation,
    resendInvitation
}