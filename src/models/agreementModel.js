import { sql } from '../config/db.js';

const insertAgreements = async (pool, clientId, agreementData) => {
    await pool.request()
    .input('client_id', sql.BigInt, clientId)
    .input('agreement_version', sql.Decimal, agreementData.agreement_version)
    .input('agreement_type', sql.VarChar, agreementData.agreement_type)
    .input('accepted', sql.Bit, agreementData.accepted)
    .input('ip_address', sql.VarChar, agreementData.ip_address)
    .input('user_agent', sql.NVarChar, agreementData.user_agent)
    .input('created_by', sql.VarChar, agreementData.created_by)
    .execute('usp_ins_agreements')
}

export default {
    insertAgreements
}