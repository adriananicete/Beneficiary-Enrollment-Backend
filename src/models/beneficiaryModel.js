import { sql } from '../config/db.js';
import { chunk } from '../utils/concurrency.js';

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

// SQL Server caps a statement at 2,100 parameters, and this binds one per
// enrollment. Chunking keeps a large export well under that rather than
// discovering the ceiling on the day a third client company is onboarded.
const ID_CHUNK_SIZE = 1000;

// Reads beneficiaries for many enrollments at once. usp_sel_beneficiaries takes
// a single id, so using it here would mean one round trip per employee.
//
// A raw query rather than a procedure, and the distinction from the export's
// company scoping matters: that scoping is an access rule and lives in exactly
// one place, usp_sel_hr_employees. This carries no access rule at all — the ids
// arrive already limited to the caller's company, so it only fetches what it is
// given. See md/PAGING-DBA-REQUEST.md.
const getBeneficiariesByEnrollmentIds = async (pool, enrollmentIds) => {
    const ids = [...new Set(
        enrollmentIds
            .filter((id) => id !== null && id !== undefined)
            .map((id) => String(id)),
    )];

    if (ids.length === 0) return [];

    const rows = [];

    for (const group of chunk(ids, ID_CHUNK_SIZE)) {
        const request = pool.request();

        // Bound one per id rather than interpolated. These come from our own
        // query, but building SQL by string is a habit worth not having.
        const placeholders = group.map((id, index) => {
            request.input(`id${index}`, sql.BigInt, id);
            return `@id${index}`;
        });

        const result = await request.query(`
            SELECT beneficiary_id, enrollment_id, full_name,
                   relationship, age, coverage_percent
            FROM dbo.beneficiaries
            WHERE status = 'A'
              AND enrollment_id IN (${placeholders.join(', ')})
            ORDER BY enrollment_id, beneficiary_id`);

        rows.push(...result.recordset);
    }

    return rows;
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