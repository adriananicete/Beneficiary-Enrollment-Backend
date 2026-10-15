import EnrollmentWipeModel from "../models/enrollmentWipeModel.js";
import EmployerAdminModel from "../models/employerAdminModel.js";
import InvitationModel from "../models/invitationModel.js";
import { isNumericId } from "../middlewares/validateIdParam.js";
import { SUPER_ADMIN } from "../utils/constants.js";
import { AppError } from "../utils/AppError.js";

// Clears a company's test enrollees so testing can start again without the
// DBA. Section G of md/COMPANY-ONBOARDING-DECISIONS.md, DBA request 26.
// Development only: the route does not exist in production.
//
// HR wipes its own company; the Administrator names one. Either way the caller
// types the company's code to confirm. It is checked here first, against the
// company as the backend reads it, and the procedure checks it again.

const sameCode = (a, b) =>
  String(a ?? "").trim().toUpperCase() === String(b ?? "").trim().toUpperCase();

// The employer_id from the body as text, or undefined when none was sent.
// Text or a number only, as in claimService: String() on a crafted object can
// throw, which would answer 500.
const companyIdOf = (value) => {
  if (value === undefined || value === null || value === "") return undefined;
  if ((typeof value === "string" || typeof value === "number") && isNumericId(value))
    return String(value);
  throw new AppError("employer_id must be a company id", 400);
};

// HR's company is the first it is mapped to, as for its invitations. An
// employer_id is not needed; one that is not theirs is refused rather than
// quietly replaced, so nobody believes they wiped a company they did not.
const hrCompany = async (pool, userId, employerId) => {
  const employers = await InvitationModel.getEmployersByUser(pool, userId);
  if (employers.length === 0)
    throw new AppError("No company is assigned to your account", 403);

  const company = employers[0];
  if (employerId !== undefined && employerId !== String(company.employer_id))
    throw new AppError("You can only wipe your own company's enrollments", 403);

  return company;
};

const namedCompany = async (pool, userId, employerId) => {
  if (employerId === undefined) throw new AppError("employer_id is required", 400);

  const company = await EmployerAdminModel.getCompanyById(pool, userId, employerId);
  if (!company) throw new AppError("Company not found", 404);

  return company;
};

const wipe = async (pool, user, { employer_id, confirm } = {}) => {
  if (typeof confirm !== "string" || confirm.trim() === "")
    throw new AppError("confirm is required: type the company's code", 400);

  const employerId = companyIdOf(employer_id);

  const company =
    user.role_name === SUPER_ADMIN
      ? await namedCompany(pool, user.user_id, employerId)
      : await hrCompany(pool, user.user_id, employerId);

  if (!sameCode(confirm, company.company_code))
    throw new AppError("The confirmation does not match the company code", 400);

  const result = await EnrollmentWipeModel.wipeCompanyEnrollees(
    pool,
    user.user_id,
    company.employer_id,
    confirm.trim(),
  );

  const answer = {
    employer_id: company.employer_id,
    company_code: company.company_code,
    people_deleted: result.people_deleted,
    enrollments_deleted: result.enrollments_deleted,
  };

  // The wiped accounts' audit rows go with them, so this line is the record of
  // who cleared what.
  console.warn("Company enrollees wiped:", { by: user.user_id, ...answer });

  return answer;
};

export default { wipe };
