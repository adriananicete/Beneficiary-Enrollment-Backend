import EmployerAdminModel from "../models/employerAdminModel.js";
import { COMPANY_FIELDS } from "../utils/validateCompany.js";
import { AppError } from "../utils/AppError.js";
import { assertPlanChange, planFieldsOf, savePlan } from "../gcli/companies.js";
import { devStoreOn } from "../gcli/devStore.js";

// The Administrator lists, creates and edits companies. Branch 2 of
// md/COMPANY-ONBOARDING-DECISIONS.md, on DBA request 24. The procedures refuse
// anybody who is not an active Administrator, so a route that lost its role
// check would still be refused.

// What leaves, named field by field. The HR account is null until branch 4
// creates one.
export const companyOf = (row) => ({
  employer_id: row.employer_id,
  company_code: row.company_code,
  company_name: row.company_name,
  work_address: row.work_address,
  office_no: row.office_no,
  policy_no: row.policy_no,
  status: row.status,
  send_coc_email: row.send_coc_email,
  messages_enabled: row.messages_enabled,
  online_enrollment_max_age: row.online_enrollment_max_age,
  hr_account: row.hr_user_id
    ? {
        user_id: row.hr_user_id,
        username: row.hr_username,
        email_address: row.hr_email_address,
      }
    : null,
  active_classifications: row.active_classifications,
  active_enrollments: row.active_enrollments,
  // True once the company has any enrollment: the policy number can no
  // longer change (50188), so the form can disable the field.
  policy_no_locked: row.policy_no_locked,
  created_by: row.created_by,
  created_date: row.created_date,
  modified_by: row.modified_by,
  modified_date: row.modified_date,
  // The plan and the loan limits, while the dev store is on (src/gcli): the database
  // has neither yet.
  ...(devStoreOn() ? planFieldsOf(row.employer_id, row.policy_no_locked) : {}),
});

const getCompanies = async (pool, userId) => {
  const rows = await EmployerAdminModel.getCompanies(pool, userId);
  return rows.map(companyOf);
};

const getCompany = async (pool, userId, employerId) => {
  const row = await EmployerAdminModel.getCompanyById(pool, userId, employerId);
  if (!row) throw new AppError("Company not found", 404);

  return companyOf(row);
};

// Answers the company as stored, read back, rather than echoing what was
// sent. `plan` is the plan and loan limits taken off the request (src/gcli), only
// with the dev store on.
const createCompany = async (pool, userId, company, plan) => {
  if (plan) assertPlanChange(null, plan);

  const employerId = await EmployerAdminModel.createCompany(pool, userId, company);
  if (plan) savePlan(employerId, plan);

  return getCompany(pool, userId, employerId);
};

// A PATCH carries only what changed. The procedure replaces the whole row, so
// the changes are laid over the stored company first. Two Administrators
// saving the same company at once: the later save wins (accepted 2026-10-15).
// A change of plan alone (`plan`, src/gcli) leaves the row as it is.
const updateCompany = async (pool, userId, employerId, changes, plan) => {
  const current = await EmployerAdminModel.getCompanyById(pool, userId, employerId);
  if (!current) throw new AppError("Company not found", 404);

  if (plan) assertPlanChange(employerId, plan, current.policy_no_locked);

  if (!plan || Object.keys(changes).length > 0) {
    const merged = {};
    for (const field of COMPANY_FIELDS)
      merged[field] = field in changes ? changes[field] : current[field];

    await EmployerAdminModel.updateCompany(pool, userId, employerId, merged);
  }

  if (plan) savePlan(employerId, plan);

  return getCompany(pool, userId, employerId);
};

// A company created by mistake or for a test (branch 10). The procedure
// decides whether anything belongs to it (50212, 409) and whether it exists
// (50187, 404); a company with employees is deactivated instead, later.
const deleteCompany = async (pool, userId, employerId) => {
  await EmployerAdminModel.deleteCompany(pool, userId, employerId);
};

export default {
  getCompanies,
  getCompany,
  createCompany,
  updateCompany,
  deleteCompany,
};
