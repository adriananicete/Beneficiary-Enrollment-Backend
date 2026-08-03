
export const getBarangays = async (pool) => {
    const result = await pool.request()
    .execute('usp_sel_barangays');

    return result.recordset;
};

export const getEmployeeClassifications = async (pool) => {
    const result = await pool.request()
    .execute('usp_sel_employee_classifications');

    return result.recordset;
};

export const getEmployers = async (pool) => {
    const result = await pool.request()
    .execute('usp_sel_employers');

    return result.recordset;
}

export default {
    getBarangays,
    getEmployeeClassifications,
    getEmployers
}