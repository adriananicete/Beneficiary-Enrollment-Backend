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

export default {
    getInvitationByToken,
    getInvitationsByUser,
}