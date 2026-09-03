import { sql } from "../config/db.js";

export const getEmployeeClassifications = async (pool) => {
    const result = await pool.request()
    .execute('usp_sel_employee_classifications');

    return result.recordset;
};

export const getEmployers = async (pool) => {
    const result = await pool.request()
    .execute('usp_sel_employers');

    return result.recordset;
};

export const getRegions = async (pool) => {
   const result = await pool.request()
   .execute('usp_sel_regions');

   return result.recordset;
};

export const getProvincesByRegion = async (pool, regionCode) => {
    const result = await pool.request()
    .input('region_code', sql.VarChar(2), regionCode)
    .execute('usp_sel_provinces_by_region');

    return result.recordset;
};

export const getCitiesByProvince = async (pool, provinceCode) => {
    const result = await pool.request()
    .input('province_code', sql.VarChar(4), provinceCode)
    .execute('usp_sel_cities_by_province');

    return result.recordset;
};

export const getBarangaysByCity = async (pool, cityCode) => {
    const result = await pool.request()
    .input('city_municipality_code', sql.VarChar(6), cityCode)
    .execute('usp_lst_barangays_by_city');

    return result.recordset;
};

// Confirms a barangay code actually exists before it is stored.
//
// A raw query because the reference procedures all list by parent — there is
// none that answers "is this one code real", and listing every barangay in a
// city to search it in JavaScript would be a worse shape for a yes/no question.
//
// The code is compared as given. barangay_id is VARCHAR with a meaningful
// leading zero, and this check is the last place that would notice one going
// missing — so it must not coerce, trim to a number, or pad.
export const barangayExists = async (pool, barangayId) => {
    const result = await pool.request()
    .input('brgy_code', sql.VarChar(9), barangayId)
    .query(`SELECT 1 FROM dbo.barangay WHERE brgy_code = @brgy_code`);

    return result.recordset.length > 0;
};

export default {
    getEmployeeClassifications,
    getEmployers,
    getRegions,
    getProvincesByRegion,
    getCitiesByProvince,
    getBarangaysByCity,
    barangayExists
}