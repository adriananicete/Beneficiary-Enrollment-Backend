import { sql } from '../config/db.js';

const insertApplication = async (pool, applicationData) => {
    const result = await pool.request()
    .input('client_id', sql.BigInt, applicationData.client_id)
    .input('client_employer_id', sql.BigInt, applicationData.client_employer_id)
    .input('classification_id', sql.BigInt, applicationData.classification_id)
    .input('created_by', sql.VarChar, applicationData.created_by)
    .output('enrollment_id', sql.BigInt)
    .execute('usp_ins_insurance_enrollment');

    return result.output.enrollment_id
}

export default {
    insertApplication,

}