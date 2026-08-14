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

export default {
    getEmployeeClassifications,
    getEmployers,
    getRegions,
    getProvincesByRegion,
    getCitiesByProvince,
    getBarangaysByCity

}