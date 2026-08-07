import { sql } from '../config/db.js';

const insertAgreements = async (pool, clientId, agreementData) => {
    await pool.request()
    .input('client_id', sql.BigInt, clientId)
    .input('agreement_version', sql.Decimal(5,2), agreementData.agreement_version)
    .input('agreement_type', sql.VarChar(30), agreementData.agreement_type)
    .input('accepted', sql.Bit, agreementData.accepted)
    .input('ip_address', sql.VarChar(45), agreementData.ip_address)
    .input('user_agent', sql.VarChar(500), agreementData.user_agent)
    .input('created_by', sql.VarChar, agreementData.created_by)
    .execute('usp_ins_agreements')
};

const getClientAgreements = async (pool, clientId) => {
    const result = await pool.request()
    .input('client_id', sql.BigInt, clientId)
    .execute('usp_sel_client_agreement');

    return result.recordset
}

export default {
    insertAgreements,
    getClientAgreements
}