import { sql } from "../config/db.js";
import ClassificationAdminModel from "../models/classificationAdminModel.js";
import EmployerAdminModel from "../models/employerAdminModel.js";
import { BENEFIT_CODES, FORMULA_BENEFITS } from "../utils/validateClassification.js";
import { AppError } from "../utils/AppError.js";

// A company's schedule: its classes and what each one pays. The Administrator
// creates and edits it. Branch 3 of md/COMPANY-ONBOARDING-DECISIONS.md, on DBA
// request 24.
//
// A changed amount applies to enrollments from then on. An enrollment already
// made keeps the snapshot copied into enrollment_benefits when it was made.

const isFormula = (code) => FORMULA_BENEFITS.includes(code);

// The procedure's rows (one per class and active benefit) as classes, in the
// procedure's order. `benefits` has the shape the Administrator sends: a code
// and its amount, or its formula for GTIR.
export const scheduleOf = (rows) => {
  const classes = new Map();

  for (const row of rows) {
    const id = String(row.classification_id);

    if (!classes.has(id))
      classes.set(id, {
        classification_id: row.classification_id,
        classification_code: row.classification_code,
        classification_desc: row.classification_desc,
        is_active: row.is_active,
        active_enrollments: row.active_enrollments,
        modified_by: row.modified_by,
        modified_date: row.modified_date,
        benefits: {},
      });

    if (row.benefit_code)
      classes.get(id).benefits[row.benefit_code] = isFormula(row.benefit_code)
        ? row.coverage_formula
        : row.coverage_amount;
  }

  return [...classes.values()];
};

// One class's active benefits with the ids a change needs.
const storedBenefits = (rows) => {
  const stored = {};
  for (const row of rows)
    if (row.benefit_code)
      stored[row.benefit_code] = {
        benefitId: row.classification_benefit_id,
        amount: row.coverage_amount,
        formula: row.coverage_formula,
      };
  return stored;
};

// What a PATCH's benefits mean against what the class has now: an insert for a
// benefit it lacks, an update for a changed value, a retirement for null. An
// unchanged value is left alone, so its modified_date keeps meaning "this
// amount last changed then".
export const benefitChanges = (stored, requested = {}) => {
  const changes = [];

  for (const [code, value] of Object.entries(requested)) {
    const existing = stored[code];

    if (value === null) {
      if (existing) changes.push({ action: "retire", code, benefitId: existing.benefitId });
      continue;
    }

    if (!existing) {
      changes.push({ action: "insert", code, value });
      continue;
    }

    const same = isFormula(code)
      ? existing.formula === value
      : Number(existing.amount) === value;

    if (!same) changes.push({ action: "update", code, benefitId: existing.benefitId, value });
  }

  return changes;
};

// The class's own fields after a PATCH, and whether any of them changed.
export const classFieldsAfter = (row, changes) => {
  const after = {
    code: changes.classification_code ?? row.classification_code,
    desc: changes.classification_desc ?? row.classification_desc,
    isActive: changes.is_active ?? row.is_active,
  };

  const changed =
    after.code !== row.classification_code ||
    after.desc !== row.classification_desc ||
    after.isActive !== row.is_active;

  return { after, changed };
};

// The plan or rider id of each benefit code, looked up rather than hard-coded.
// A code missing from the catalogue is a setup fault, not the caller's.
const benefitTypes = async (pool, userId, codes) => {
  const rows = await ClassificationAdminModel.getBenefitTypes(pool, userId);
  const types = Object.fromEntries(
    rows.map((row) => [row.benefit_code, { planId: row.plan_id, riderId: row.rider_id }]),
  );

  const missing = codes.find((code) => !types[code]);
  if (missing)
    throw new AppError(`The ${missing} benefit is not set up. Please contact PhilLife.`, 500);

  return types;
};

const requireCompany = async (pool, userId, employerId) => {
  const company = await EmployerAdminModel.getCompanyById(pool, userId, employerId);
  if (!company) throw new AppError("Company not found", 404);
};

const writeBenefit = (transaction, userId, classificationId, types, { action, code, benefitId, value }) => {
  const valueOf = isFormula(code) ? { formula: value } : { amount: value };

  if (action === "insert")
    return ClassificationAdminModel.insertBenefit(transaction, userId, {
      classificationId,
      ...types[code],
      ...valueOf,
    });

  if (action === "update")
    return ClassificationAdminModel.updateBenefit(transaction, userId, benefitId, {
      ...valueOf,
      isActive: true,
    });

  return ClassificationAdminModel.updateBenefit(transaction, userId, benefitId, { isActive: false });
};

// Runs the writes in one transaction of ours: a class and its benefits commit
// together, or none of them does.
const inTransaction = async (pool, work) => {
  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    const result = await work(transaction);
    await transaction.commit();
    return result;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

const getSchedule = async (pool, userId, employerId) => {
  await requireCompany(pool, userId, employerId);

  const rows = await ClassificationAdminModel.getSchedule(pool, userId, employerId);
  return scheduleOf(rows);
};

const getClass = async (pool, userId, employerId, classificationId) => {
  const schedule = await getSchedule(pool, userId, employerId);
  const found = schedule.find((c) => String(c.classification_id) === String(classificationId));
  if (!found) throw new AppError("Classification not found", 404);
  return found;
};

// A class and its benefits, in the order GTLIP, GTPDR, ALCR, GTIR. Answers the
// class as stored, read back.
const createClass = async (pool, userId, employerId, body) => {
  await requireCompany(pool, userId, employerId);

  const codes = BENEFIT_CODES.filter((code) => body.benefits[code] !== undefined);
  const types = await benefitTypes(pool, userId, codes);

  const classificationId = await inTransaction(pool, async (transaction) => {
    const id = await ClassificationAdminModel.insertClassification(transaction, userId, {
      employerId,
      code: body.classification_code,
      desc: body.classification_desc,
    });

    for (const code of codes)
      await writeBenefit(transaction, userId, id, types, {
        action: "insert",
        code,
        value: body.benefits[code],
      });

    return id;
  });

  return getClass(pool, userId, employerId, classificationId);
};

// Any part of a class. The class is found in its company's schedule, so a
// class of another company is 404 (option A, 2026-10-15). Nothing is written
// when nothing would change.
const updateClass = async (pool, userId, employerId, classificationId, changes) => {
  await requireCompany(pool, userId, employerId);

  const rows = (await ClassificationAdminModel.getSchedule(pool, userId, employerId)).filter(
    (row) => String(row.classification_id) === String(classificationId),
  );
  if (rows.length === 0) throw new AppError("Classification not found", 404);

  const { after, changed } = classFieldsAfter(rows[0], changes);
  const benefitWrites = benefitChanges(storedBenefits(rows), changes.benefits);

  if (changed || benefitWrites.length > 0) {
    const inserted = benefitWrites.filter((w) => w.action === "insert").map((w) => w.code);
    const types = inserted.length > 0 ? await benefitTypes(pool, userId, inserted) : {};

    await inTransaction(pool, async (transaction) => {
      if (changed)
        await ClassificationAdminModel.updateClassification(transaction, userId, classificationId, after);

      for (const write of benefitWrites)
        await writeBenefit(transaction, userId, classificationId, types, write);
    });
  }

  return getClass(pool, userId, employerId, classificationId);
};

export default {
  getSchedule,
  createClass,
  updateClass,
};
