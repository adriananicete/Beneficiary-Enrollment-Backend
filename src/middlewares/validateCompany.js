import { AppError } from "../utils/AppError.js";
import { COMPANY_FIELDS, companyProblem, normaliseCompany } from "../utils/validateCompany.js";

// The Administrator's company routes. The rules are in utils/validateCompany.js.

// POST: a whole company. send_coc_email defaults to on, as the column does.
export const validateNewCompany = (req, res, next) => {
  const problem = normaliseCompany(req.body);
  if (problem) return next(new AppError(problem, 400));

  if (req.body.send_coc_email === undefined) req.body.send_coc_email = true;
  if (req.body.office_no === undefined) req.body.office_no = null;
  if (req.body.online_enrollment_max_age === undefined) req.body.online_enrollment_max_age = null;

  const invalid = companyProblem(req.body, COMPANY_FIELDS);
  if (invalid) return next(new AppError(invalid, 400));

  next();
};

// PATCH: any part of a company. Only the fields sent are checked; the service
// lays them over the stored company before the procedure, which replaces the
// whole row.
export const validateCompanyChanges = (req, res, next) => {
  const problem = normaliseCompany(req.body);
  if (problem) return next(new AppError(problem, 400));

  const sent = Object.keys(req.body);
  if (sent.length === 0) return next(new AppError("Nothing to change", 400));

  const invalid = companyProblem(req.body, sent);
  if (invalid) return next(new AppError(invalid, 400));

  next();
};

export default { validateNewCompany, validateCompanyChanges };
