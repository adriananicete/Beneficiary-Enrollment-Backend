import { AppError } from "../utils/AppError.js";
import {
  classificationChangesProblem,
  newClassificationProblem,
} from "../utils/validateClassification.js";

// The Administrator's classification routes. The rules are in
// utils/validateClassification.js.

// POST: a whole class, with GTLIP and any of the other three benefits.
export const validateNewClassification = (req, res, next) => {
  const problem = newClassificationProblem(req.body);
  if (problem) return next(new AppError(problem, 400));
  next();
};

// PATCH: any part of a class. A benefit sent as null is removed.
export const validateClassificationChanges = (req, res, next) => {
  const problem = classificationChangesProblem(req.body);
  if (problem) return next(new AppError(problem, 400));
  next();
};

export default { validateNewClassification, validateClassificationChanges };
