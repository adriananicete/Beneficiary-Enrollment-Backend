import { sql } from "../config/db.js";

// A company's affiliates, DBA request 25 Parts 3 and 4, read 2026-10-15 before
// delivery. The Administrator's three refuse anybody who is not an active
// Administrator (50182); HR's list refuses anybody who is not active HR
// (50208). None has an OUTPUT parameter: the id comes back in a result set.
//
// The two writes own their transaction, so they take the pool.
//
// The code and the reference are bound wider than their columns (20) on
// purpose, as the procedures declare them, so a value that is too long is
// refused (50200, 50204) rather than cut by the driver.

const bindAffiliate = (request, affiliate) =>
    request
    .input('affiliate_code', sql.VarChar(50), affiliate.affiliate_code)
    .input('affiliate_name', sql.VarChar(200), affiliate.affiliate_name)
    .input('reference_no', sql.VarChar(50), affiliate.reference_no);

// One company's affiliates, active and inactive, with each one's current
// employees and whether its reference is fixed.
const getAffiliates = async (pool, userId, employerId) => {
    const result = await pool.request()
    .input('us01_user_id', sql.BigInt, userId)
    .input('employer_id', sql.BigInt, employerId)
    .execute('bes.usp_sel_employer_affiliates_admin');

    return result.recordset;
};

// THROWs 50187 (company missing or inactive), 50200–50205.
const insertAffiliate = async (pool, userId, employerId, affiliate) => {
    const result = await bindAffiliate(
        pool.request()
        .input('us01_user_id', sql.BigInt, userId)
        .input('employer_id', sql.BigInt, employerId),
        affiliate,
    )
    .input('created_by', sql.VarChar(50), String(userId))
    .execute('bes.usp_ins_employer_affiliate');

    return result.recordset[0].affiliate_id;
};

// Replaces every field as sent; the caller sends the whole affiliate. THROWs
// 50200–50207.
const updateAffiliate = async (pool, userId, affiliateId, affiliate) => {
    await bindAffiliate(
        pool.request()
        .input('us01_user_id', sql.BigInt, userId)
        .input('affiliate_id', sql.BigInt, affiliateId),
        affiliate,
    )
    .input('is_active', sql.Bit, affiliate.is_active)
    .input('modified_by', sql.VarChar(50), String(userId))
    .execute('bes.usp_upd_employer_affiliate');
};

// HR's list: the active affiliates of every active company the account is
// mapped to, each row with its employer_id.
const getAffiliatesByUser = async (pool, userId) => {
    const result = await pool.request()
    .input('us01_user_id', sql.BigInt, userId)
    .execute('bes.usp_sel_employer_affiliates_by_user');

    return result.recordset;
};

export default {
    getAffiliates,
    insertAffiliate,
    updateAffiliate,
    getAffiliatesByUser,
};
