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

export default {
    insertBeneficiary
}