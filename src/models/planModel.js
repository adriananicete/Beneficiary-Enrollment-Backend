// The plans a company can be on: dbo.ref_plans, read 2026-10-27 (plan_id, plan_code,
// plan_desc, template, is_active, and amounts that no plan fills in yet).
//
// A raw read, like getClaimTypeFiler: there is no procedure that lists the plans.
// Nothing here writes. A plan is switched on or off by the DBA.
const getPlans = async (pool) => {
    const result = await pool.request()
    .query('SELECT plan_id, plan_code, plan_desc, template, is_active FROM dbo.ref_plans ORDER BY plan_id');

    return result.recordset;
};

export default { getPlans };
