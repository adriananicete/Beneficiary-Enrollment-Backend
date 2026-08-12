import { sql } from '../config/db.js';

const insertBeneficiary = async (pool, beneficiaryData) => {
    const result = await pool.request()
    .output('beneficiary_id', sql.BigInt)
    .input('enrollment_id', sql.BigInt, beneficiaryData.enrollment_id)
    .input('full_name', sql.VarChar, beneficiaryData.full_name)
    .input('relationship', sql.VarChar, beneficiaryData.relationship)
    .input('age', sql.Int, beneficiaryData.age)
    .input('created_by', sql.VarChar, beneficiaryData.created_by)
    .input('coverage_percent', sql.Decimal, beneficiaryData.coverage_percent)
    .execute('usp_ins_beneficiary');

    return result.output.beneficiary_id;
}

const updateBeneficiary = async (pool, beneficiaryData) => {
    const result = await pool.request()
    .input('beneficiary_id', sql.BigInt, beneficiaryData.beneficiary_id)
    .input('full_name', sql.VarChar, beneficiaryData.full_name)
    .input('relationship', sql.VarChar, beneficiaryData.relationship)
    .input('age', sql.Int, beneficiaryData.age)
    .input('coverage_percent', sql.Decimal, beneficiaryData.coverage_percent)
    .input('modified_by', sql.VarChar, beneficiaryData.modified_by)
    .execute('usp_upd_beneficiary');
}

const getBeneficiariesByEnrollmentId = async (pool, enrollment_id) => {
    const result = await pool.request()
    .input('enrollment_id', sql.BigInt, enrollment_id)
    .execute('usp_sel_beneficiaries');

    return result.recordset;
}

const deleteBeneficiary = async (pool, beneficiaryId, modifiedBy) => {
    await pool.request()
    .input('beneficiary_id', sql.BigInt, beneficiaryId)
    .input('modified_by', sql.VarChar(50), modifiedBy)
    .execute('usp_del_beneficiary');
}

export default {
    insertBeneficiary,
    updateBeneficiary,
    deleteBeneficiary,
    getBeneficiariesByEnrollmentId
}