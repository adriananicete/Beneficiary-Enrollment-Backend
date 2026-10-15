import { AppError } from "../utils/AppError.js";
import { trimStrings } from "../utils/trimStrings.js";
import { validateTextFields } from "../utils/validateTextFields.js";
import { validateFieldLengths } from "../utils/validateFieldLengths.js";
import { validateEmailAddress } from "../utils/validateEmailAddress.js";

// The person behind a company's HR account, as the Administrator types it
// (branch 4 of the onboarding effort). The username is generated from the
// company code and the password by the system, so neither is accepted here.
//
// Widths are sec.us01_users: names 100, email 150.

const FIELDS = ["first_name", "middle_name", "last_name", "email_address"];

const LENGTHS = { first_name: 100, middle_name: 100, last_name: 100, email_address: 150 };

const NAME_RULES = { first_name: "name", middle_name: "name", last_name: "name" };

export const hrAccountProblem = (body) => {
  if (!body || typeof body !== "object" || Array.isArray(body))
    return "The request body must be an object";

  const unknown = Object.keys(body).find((key) => !FIELDS.includes(key));
  if (unknown) return `${unknown} is not a field of an HR account`;

  trimStrings(body);
  if (body.middle_name === "") body.middle_name = null;

  for (const field of ["first_name", "last_name", "email_address"])
    if (!body[field]) return `${field} is required`;

  return (
    validateFieldLengths(body, LENGTHS) ??
    validateTextFields(body, NAME_RULES) ??
    validateEmailAddress(body.email_address)
  );
};

export const validateHrAccount = (req, res, next) => {
  const problem = hrAccountProblem(req.body);
  if (problem) return next(new AppError(problem, 400));
  next();
};

export default { validateHrAccount, hrAccountProblem };
