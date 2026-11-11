import { getPool } from "../config/db.js";
import ReferenceModel from "../models/referenceModel.js";
import IpsModel from "../models/ipsModel.js";
import { AppError } from "../utils/AppError.js";
import { isNumericId } from "../middlewares/validateIdParam.js";

// What IPS reads (md/IPS-INTEGRATION-DECISIONS.md). Every company, inactive ones included with
// their status, so IPS can walk each company's enrollees. The group policy number is on every
// enrollee row (branch 2), so it is not repeated here.
export const ipsCompanyOf = (row) => ({
  employer_id: row.employer_id,
  company_code: row.company_code,
  company_name: row.company_name,
  status: row.status,
});

// Built from what it uses, so a test can replace them. `rows` goes on res.locals for the call
// log, which counts rows and never reads them.
export const createGetIpsCompanies =
  ({ poolOf = getPool, employersOf = (pool) => ReferenceModel.getEmployers(pool, { includeInactive: true }) } = {}) =>
  async (req, res, next) => {
    try {
      const rows = await employersOf(await poolOf());
      res.locals.ipsRows = rows.length;

      return res.status(200).json({
        success: true,
        data: { as_of: new Date().toISOString(), rows: rows.map(ipsCompanyOf) },
      });
    } catch (error) {
      next(error);
    }
  };

export const getIpsCompanies = createGetIpsCompanies();

// ── A company's enrollees, a page at a time (branch 2, DBA request 33) ──────

export const MAX_IPS_PAGE = 100;

// ?after=<client_id>&limit=. `after` is the last client_id IPS already has, and
// is refused when it cannot be one: a wrong guess would skip people. `limit` is
// held to 1–100, the procedure's own bounds, rather than refused.
export const ipsPageOf = (query = {}) => {
  let after = null;

  if (query.after !== undefined && query.after !== "") {
    if (typeof query.after !== "string" || !isNumericId(query.after)) throw new AppError("after must be a client_id", 400);
    after = query.after;
  }

  const asked = Number.parseInt(query.limit, 10);
  const limit = Number.isInteger(asked) && asked > 0 ? Math.min(asked, MAX_IPS_PAGE) : MAX_IPS_PAGE;

  return { after, limit };
};

// One enrollee as IPS gets it: everything the Administrator's enrollment detail
// shows (decided 2026-11-11), named field by field so a column the procedure
// gains later stays out until somebody adds it here. Dates of type DATE are
// "YYYY-MM-DD" (db.js).
export const ipsEnrolleeOf = (person, benefits = [], beneficiaries = []) => ({
  client_id: person.client_id,
  enrollment_id: person.enrollment_id,
  employee_id_number: person.employee_id_number,
  policy_no: person.policy_no,
  group_policy_no: person.group_policy_no,
  first_name: person.first_name,
  middle_name: person.middle_name,
  last_name: person.last_name,
  suffix: person.suffix,
  birthdate: person.birthdate,
  birthplace: person.birthplace,
  nationality: person.nationality,
  gender: person.gender,
  civil_status: person.civil_status,
  height: person.height,
  weight: person.weight,
  tin_id: person.tin_id,
  sss_gsis_no: person.sss_gsis_no,
  contact_no: person.contact_no,
  email_address: person.email_address,
  occupation: person.occupation,
  source_of_income: person.source_of_income,
  address: {
    full_address: person.full_address,
    barangay: person.brgy_name,
    city: person.city_municipality_name,
    province: person.province_name,
    region: person.region_name,
    zip_code: person.zip_code,
  },
  company: {
    employer_id: person.employer_id,
    company_code: person.company_code,
    company_name: person.company_name,
  },
  position_title: person.position_title,
  // null for the company's own employees.
  affiliate:
    person.affiliate_id == null
      ? null
      : { affiliate_id: person.affiliate_id, affiliate_code: person.affiliate_code, affiliate_name: person.affiliate_name },
  classification: {
    classification_id: person.classification_id,
    classification_code: person.classification_code,
    classification_desc: person.classification_desc,
  },
  enrollment_date: person.enrollment_date,
  status: person.status,
  date_of_death: person.date_of_death,
  benefits: benefits.map((benefit) => ({
    enrollment_benefit_id: benefit.enrollment_benefit_id,
    benefit_type: benefit.benefit_type,
    benefit_name: benefit.benefit_name,
    benefit_description: benefit.benefit_description,
    coverage_amount: benefit.coverage_amount,
    coverage_formula: benefit.coverage_formula,
  })),
  beneficiaries: beneficiaries.map((beneficiary) => ({
    beneficiary_id: beneficiary.beneficiary_id,
    full_name: beneficiary.full_name,
    relationship: beneficiary.relationship,
    age: beneficiary.age,
    coverage_percent: beneficiary.coverage_percent,
  })),
});

const byEnrollment = (rows) => {
  const grouped = new Map();

  for (const row of rows) {
    const key = String(row.enrollment_id);
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }

  return grouped;
};

// GET /api/v1/integration/ips/companies/:employer_id/enrollees. The answer is
// { as_of, rows, next_after }: pass next_after as `after` for the next page;
// null means this was the last. An unknown company is 404 (50187), so it does
// not read as a company with no enrollees.
export const createGetIpsEnrollees =
  ({ poolOf = getPool, read = IpsModel.getEnrollees } = {}) =>
  async (req, res, next) => {
    try {
      // Checked here rather than on the route, so the gate is still all a route
      // has before its controller.
      if (!isNumericId(req.params.employer_id)) throw new AppError("Company not found", 404);

      const { after, limit } = ipsPageOf(req.query);
      const asOf = new Date().toISOString();

      const page = await read(await poolOf(), { employerId: req.params.employer_id, afterClientId: after, limit });

      const benefits = byEnrollment(page.benefits);
      const beneficiaries = byEnrollment(page.beneficiaries);

      const rows = page.people.map((person) =>
        ipsEnrolleeOf(person, benefits.get(String(person.enrollment_id)), beneficiaries.get(String(person.enrollment_id))),
      );

      res.locals.ipsRows = rows.length;

      return res.status(200).json({
        success: true,
        data: { as_of: asOf, rows, next_after: page.hasMore && rows.length > 0 ? rows.at(-1).client_id : null },
      });
    } catch (error) {
      next(error);
    }
  };

export const getIpsEnrollees = createGetIpsEnrollees();
