import { sql } from '../config/db.js';

const getInvitationByToken = async (pool, token) => {
    const result = await pool.request()
    .input('token', sql.NVarChar(64), token)
    .execute('usp_sel_enrollment_invitation_by_token');

    return result.recordset[0];
}

export default {
    getInvitationByToken,
}