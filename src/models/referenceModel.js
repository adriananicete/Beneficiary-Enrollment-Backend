export const getBarangays = async (pool) => {
    const result = await pool.request()
    .execute('usp_sel_barangays');

    return result.recordset;
};

export default {
    getBarangays,
}