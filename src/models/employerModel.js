import { sql } from '../config/db.js';

const insertEmployer = async (pool, employerData) => {
    const result = await pool.request()
    .input('company_code', sql.VarChar, employerData.company_code)
    .input('company_name', sql.VarChar, employerData.company_name)
    .input('office_no', sql.VarChar, employerData.office_no)
    .input('work_address', sql.NVarChar, employerData.work_address)
    .output('employer_id', sql.BigInt)
    .execute('usp_ins_employer');

    return result.output.employer_id;
};

const insertClientEmployer = async (pool, clientEmployerData) => {
    const result =  await pool.request()
    .input('client_id', sql.BigInt, clientEmployerData.client_id)
    .input('employer_id', sql.BigInt, clientEmployerData.employer_id)
    .input('position_title', sql.VarChar, clientEmployerData.position_title)
    .input('is_current', sql.Bit, clientEmployerData.is_current)
    .input('created_by', sql.VarChar, clientEmployerData.created_by)
    .output('client_employer_id', sql.BigInt)
    .execute('usp_ins_client_employer')

    return result.output.client_employer_id;
};

export default {
    insertEmployer,
    insertClientEmployer
}