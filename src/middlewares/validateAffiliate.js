import { AppError } from "../utils/AppError.js";
import {
  NEW_AFFILIATE_FIELDS,
  affiliateProblem,
  normaliseAffiliate,
} from "../utils/validateAffiliate.js";

// The Administrator's affiliate routes. The rules are in
// utils/validateAffiliate.js.

// POST: a whole affiliate. The reference is optional and defaults to none.
export const validateNewAffiliate = (req, res, next) => {
  const problem = normaliseAffiliate(req.body, { isNew: true });
  if (problem) return next(new AppError(problem, 400));

  if (req.body.reference_no === undefined) req.body.reference_no = null;

  const invalid = affiliateProblem(req.body, NEW_AFFILIATE_FIELDS);
  if (invalid) return next(new AppError(invalid, 400));

  next();
};

// PATCH: any part of an affiliate. Only the fields sent are checked; the
// service lays them over the stored affiliate before the procedure, which
// replaces the whole row.
export const validateAffiliateChanges = (req, res, next) => {
  const problem = normaliseAffiliate(req.body, { isNew: false });
  if (problem) return next(new AppError(problem, 400));

  const sent = Object.keys(req.body);
  if (sent.length === 0) return next(new AppError("Nothing to change", 400));

  const invalid = affiliateProblem(req.body, sent);
  if (invalid) return next(new AppError(invalid, 400));

  next();
};

export default { validateNewAffiliate, validateAffiliateChanges };
