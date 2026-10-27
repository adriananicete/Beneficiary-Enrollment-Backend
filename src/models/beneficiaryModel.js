import { sql } from '../config/db.js';

const insertBeneficiary = async (pool, beneficiaryData) => {
    const result = await pool.request()
    .output('beneficiary_id', sql.BigInt)
    .input('enrollment_id', sql.BigInt, beneficiaryData.enrollment_id)
    .input('full_name', sql.VarChar, beneficiaryData.full_name)
    .input('relationship', sql.VarChar, beneficiaryData.relationship)
    .input('age', sql.Int, beneficiaryData.age)
    .input('created_by', sql.VarChar, beneficiaryData.created_by)
    .input('coverage_percent', sql.Decimal(5, 2), beneficiaryData.coverage_percent)
    .execute('usp_ins_beneficiary');

    return result.output.beneficiary_id;
}

// Reads beneficiaries for many enrollments at once. usp_sel_beneficiaries takes
// a single id, so using it here would mean one round trip per employee.
//
// This was a raw query that bound one parameter per id and chunked at 1,000 to
// stay under SQL Server's 2,100 parameter ceiling. That worked and had no
// limit left in it, but it was still several round trips for a large report.
// usp_sel_beneficiaries_by_enrollments takes the ids as one delimited string,
// so it is one.
//
// It carries no access rule, deliberately. The ids arrive already limited to
// the caller's company by usp_sel_hr_employees, which is where that scoping
// lives and where it stays — an access rule in two places is a leak waiting for
// one of them to be edited.
const getBeneficiariesByEnrollmentIds = async (pool, enrollmentIds) => {
    // Deduplicated because an id repeated in the list would duplicate its
    // beneficiaries in the report, and the procedure joins rather than filters.
    const ids = [...new Set(
        enrollmentIds
            .filter((id) => id !== null && id !== undefined)
            .map((id) => String(id)),
    )];

    if (ids.length === 0) return [];

    const result = await pool.request()
    .input('enrollment_ids', sql.VarChar(sql.MAX), ids.join(','))
    .execute('usp_sel_beneficiaries_by_enrollments');

    return result.recordset;
};

const getBeneficiariesByEnrollmentId = async (pool, enrollment_id) => {
    const result = await pool.request()
    .input('enrollment_id', sql.BigInt, enrollment_id)
    .execute('usp_sel_beneficiaries');

    return result.recordset;
}

export default {
    insertBeneficiary,
    getBeneficiariesByEnrollmentId,
    getBeneficiariesByEnrollmentIds
}