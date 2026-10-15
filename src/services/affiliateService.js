import AffiliateModel from "../models/affiliateModel.js";
import EmployerAdminModel from "../models/employerAdminModel.js";
import InvitationModel from "../models/invitationModel.js";
import { AFFILIATE_FIELDS } from "../utils/validateAffiliate.js";
import { AppError } from "../utils/AppError.js";

// A company's affiliates: companies insured under its policy, each with its
// own series of policy numbers. Branch 5 of md/COMPANY-ONBOARDING-DECISIONS.md,
// on DBA request 25. The Administrator manages them; HR lists them for its
// invitation file (branch 6).

// What the Administrator sees, named field by field.
export const affiliateOf = (row) => ({
  affiliate_id: row.affiliate_id,
  employer_id: row.employer_id,
  affiliate_code: row.affiliate_code,
  affiliate_name: row.affiliate_name,
  reference_no: row.reference_no,
  is_active: row.is_active,
  current_employees: row.current_employees,
  // True once an employee is numbered under the reference: it can no longer
  // change (50206), so the form can disable the field.
  reference_locked: row.reference_locked,
  created_by: row.created_by,
  created_date: row.created_date,
  modified_by: row.modified_by,
  modified_date: row.modified_date,
});

// What HR sees: what it needs to write the code in its file, and no more.
export const hrAffiliateOf = (row) => ({
  affiliate_id: row.affiliate_id,
  affiliate_code: row.affiliate_code,
  affiliate_name: row.affiliate_name,
});

const requireCompany = async (pool, userId, employerId) => {
  const company = await EmployerAdminModel.getCompanyById(pool, userId, employerId);
  if (!company) throw new AppError("Company not found", 404);
};

// There is no procedure for one affiliate, so it is found in its company's
// list. An affiliate of another company is not in it, and is 404.
const findAffiliate = (rows, affiliateId) => {
  const row = rows.find((candidate) => String(candidate.affiliate_id) === String(affiliateId));
  if (!row) throw new AppError("Affiliate not found", 404);
  return row;
};

const readAffiliate = async (pool, userId, employerId, affiliateId) =>
  findAffiliate(await AffiliateModel.getAffiliates(pool, userId, employerId), affiliateId);

const getAffiliates = async (pool, userId, employerId) => {
  await requireCompany(pool, userId, employerId);

  const rows = await AffiliateModel.getAffiliates(pool, userId, employerId);
  return rows.map(affiliateOf);
};

// The procedure checks the company itself (50187, missing or inactive).
// Answers the affiliate as stored, read back, rather than echoing what was
// sent.
const createAffiliate = async (pool, userId, employerId, affiliate) => {
  const affiliateId = await AffiliateModel.insertAffiliate(pool, userId, employerId, affiliate);
  return affiliateOf(await readAffiliate(pool, userId, employerId, affiliateId));
};

// A PATCH carries only what changed. The procedure replaces the whole row, so
// the changes are laid over the stored affiliate first, and nothing is written
// when nothing would change. Two Administrators saving the same affiliate at
// once: the later save wins, as with a company.
const updateAffiliate = async (pool, userId, employerId, affiliateId, changes) => {
  await requireCompany(pool, userId, employerId);
  const current = await readAffiliate(pool, userId, employerId, affiliateId);

  const merged = {};
  for (const field of AFFILIATE_FIELDS)
    merged[field] = field in changes ? changes[field] : current[field];

  if (AFFILIATE_FIELDS.some((field) => merged[field] !== current[field]))
    await AffiliateModel.updateAffiliate(pool, userId, affiliateId, merged);

  return affiliateOf(await readAffiliate(pool, userId, employerId, affiliateId));
};

// HR's own company's active affiliates. The company is the first the account
// is mapped to, as for its classes and its invitations
// (classificationService.getForUser). The procedure answers for every company
// the account is mapped to, so the rest are left out here. An empty list means
// the company has none.
const getForUser = async (pool, userId) => {
  const employers = await InvitationModel.getEmployersByUser(pool, userId);
  if (employers.length === 0)
    throw new AppError("No company is assigned to your account", 403);

  const company = String(employers[0].employer_id);
  const rows = await AffiliateModel.getAffiliatesByUser(pool, userId);

  return rows.filter((row) => String(row.employer_id) === company).map(hrAffiliateOf);
};

export default {
  getAffiliates,
  createAffiliate,
  updateAffiliate,
  getForUser,
};
