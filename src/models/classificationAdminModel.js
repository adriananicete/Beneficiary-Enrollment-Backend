import { sql } from "../config/db.js";

// The Administrator's classification procedures, DBA request 24, read back
// 2026-10-15. Every one takes the caller and refuses anybody who is not an
// active Administrator (50182). None has an OUTPUT parameter.
//
// The four writes open no transaction of their own: a class and its benefits
// are written inside one of ours, so they are handed the transaction, not the
// pool.

// Every class of one company, active or retired, one row per active benefit
// (a class with none appears once, its benefit columns NULL), with how many
// active enrollments use each class. The only list with amounts.
const getSchedule = async (pool, userId, employerId) => {
    const result = await pool.request()
    .input('us01_user_id', sql.BigInt, userId)
    .input('employer_id', sql.BigInt, employerId)
    .execute('usp_sel_classifications_admin');

    return result.recordset;
};

// The ids of GTLIP (a plan) and GTPDR, ALCR and GTIR (riders), looked up by
// code so that none is hard-coded.
const getBenefitTypes = async (pool, userId) => {
    const result = await pool.request()
    .input('us01_user_id', sql.BigInt, userId)
    .execute('usp_sel_benefit_types');

    return result.recordset;
};

// THROWs 50187 (company), 50189 (code length), 50190 (code taken).
const insertClassification = async (transaction, userId, { employerId, code, desc }) => {
    const result = await transaction.request()
    .input('us01_user_id', sql.BigInt, userId)
    .input('employer_id', sql.BigInt, employerId)
    .input('classification_code', sql.VarChar(50), code)
    .input('classification_desc', sql.VarChar(200), desc)
    .input('created_by', sql.VarChar(50), String(userId))
    .execute('usp_ins_classification');

    return result.recordset[0].classification_id;
};

// Replaces the code, the description and is_active. THROWs 50189–50191.
const updateClassification = async (transaction, userId, classificationId, { code, desc, isActive }) => {
    await transaction.request()
    .input('us01_user_id', sql.BigInt, userId)
    .input('classification_id', sql.BigInt, classificationId)
    .input('classification_code', sql.VarChar(50), code)
    .input('classification_desc', sql.VarChar(200), desc)
    .input('is_active', sql.Bit, isActive)
    .input('modified_by', sql.VarChar(50), String(userId))
    .execute('usp_upd_classification');
};

// One of a plan or a rider; one of an amount or a formula. Decimal(18,2), the
// column's own type: a bare sql.Decimal is (18,0) and would round centavos
// away before SQL Server saw them. THROWs 50191–50194.
const insertBenefit = async (transaction, userId, { classificationId, planId, riderId, amount, formula }) => {
    await transaction.request()
    .input('us01_user_id', sql.BigInt, userId)
    .input('classification_id', sql.BigInt, classificationId)
    .input('plan_id', sql.BigInt, planId ?? null)
    .input('rider_id', sql.BigInt, riderId ?? null)
    .input('coverage_amount', sql.Decimal(18, 2), amount ?? null)
    .input('coverage_formula', sql.VarChar(100), formula ?? null)
    .input('created_by', sql.VarChar(50), String(userId))
    .execute('usp_ins_classification_benefit');
};

// A new amount or formula, or retired with isActive false. A benefit is never
// deleted: enrollment snapshots point at it. THROWs 50193–50195.
const updateBenefit = async (transaction, userId, benefitId, { amount, formula, isActive }) => {
    await transaction.request()
    .input('us01_user_id', sql.BigInt, userId)
    .input('classification_benefit_id', sql.BigInt, benefitId)
    .input('coverage_amount', sql.Decimal(18, 2), amount ?? null)
    .input('coverage_formula', sql.VarChar(100), formula ?? null)
    .input('is_active', sql.Bit, isActive)
    .input('modified_by', sql.VarChar(50), String(userId))
    .execute('usp_upd_classification_benefit');
};

export default {
    getSchedule,
    getBenefitTypes,
    insertClassification,
    updateClassification,
    insertBenefit,
    updateBenefit,
};
