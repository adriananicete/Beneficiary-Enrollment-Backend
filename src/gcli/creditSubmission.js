import InvitationModel from "../models/invitationModel.js";
import ReferenceModel from "../models/referenceModel.js";
import UserModel from "../models/userModel.js";
import { AppError } from "../utils/AppError.js";
import { isInvitationToken } from "../middlewares/validateIdParam.js";
import { validateBirthdate } from "../utils/validateBirthdate.js";
import { normaliseCivilStatus, validateCivilStatus } from "../utils/validateCivilStatus.js";
import { normaliseContactNo, validateContactNo } from "../utils/validateContactNo.js";
import { ADDRESS_FIELD_LENGTHS, CLIENT_FIELD_LENGTHS, validateFieldLengths } from "../utils/validateFieldLengths.js";
import { normaliseGender, validateGender } from "../utils/validateGender.js";
import { validateHeight } from "../utils/validateHeight.js";
import { CLIENT_TEXT_RULES, validateTextFields } from "../utils/validateTextFields.js";
import { normaliseTinId, validateTinId } from "../utils/validateTinId.js";
import { trimStrings } from "../utils/trimStrings.js";
import { validateWeight } from "../utils/validateWeight.js";
import { validateZipCode } from "../utils/validateZipCode.js";
import { applicationOfToken, submitApplication } from "./applications.js";
import { creditCompanyOf, isCreditTemplate, planFieldsOf } from "./companies.js";
import { devStoreOn } from "./devStore.js";
import { parseDay, wholeNumber } from "./loanRules.js";

// The borrower's side of Group Credit Life (docs/backend-handoff.md 2.12 B): what the
// invitation link tells the form, and the submit that stores an application instead of
// making an enrollment.

// Employment, income and beneficiaries are not asked of a borrower (the lender is the
// beneficiary), and neither is a classification: none of them is required here.
const REQUIRED = [
  "employee_id_number",
  "first_name",
  "last_name",
  "address_line",
  "nationality",
  "tin_id",
  "barangay_id",
  "zip_code",
  "birthplace",
  "birthdate",
  "civil_status",
  "gender",
  "height",
  "weight",
  "contact_no",
  "consent_privacy",
  "consent_terms",
  "token",
];

// Fields the database would coerce to text but this store keeps as sent, so each must be
// text here: a number or a list would otherwise be stored, and shown to HR, as it came.
const TEXT_FIELDS = ["employee_id_number", "address_line", "birthplace", "barangay_id", "tin_id"];

// The loan object the form sends, checked for its shape. Whether it fits the company's
// limits is the application's to say (422), because that needs the limits.
const loanShapeProblem = (loan) => {
  if (!loan || typeof loan !== "object" || Array.isArray(loan)) return "loan is required";

  for (const field of ["loan_reference", "purpose"]) {
    if (typeof loan[field] !== "string" || loan[field].trim() === "") return `loan.${field} is required`;
  }
  if (loan.loan_reference.trim().length > 30) return "loan.loan_reference must not exceed 30 characters";
  if (loan.purpose.trim().length > 100) return "loan.purpose must not exceed 100 characters";

  for (const field of ["loan_amount", "term_months"]) {
    if (wholeNumber(loan[field]) === null) return `loan.${field} must be a whole number of up to 9 digits`;
  }
  if (!parseDay(loan.release_date)) return "loan.release_date must be a date (YYYY-MM-DD)";

  return null;
};

// The first problem with the form, as a sentence, or null. Trims and normalises the body
// in place, in the order the usual submit does (validateEnrollment.js), minus employment,
// income, classification and beneficiaries.
export const creditProblem = (body) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "The request body must be an object";

  trimStrings(body);
  if (typeof body.loan === "object" && body.loan !== null) trimStrings(body.loan);

  body.gender = normaliseGender(body.gender);
  body.civil_status = normaliseCivilStatus(body.civil_status);
  body.tin_id = normaliseTinId(body.tin_id);
  body.contact_no = normaliseContactNo(body.contact_no);

  for (const field of REQUIRED) {
    if (!body[field]) return `${field} is required`;
  }
  for (const field of TEXT_FIELDS) {
    if (typeof body[field] !== "string") return `${field} must be text`;
  }

  // Optional, as in the usual form, and kept to the width HR's edit holds it to.
  const office = body.office_no;
  if (office !== undefined && office !== null && (typeof office !== "string" || office.length > 30))
    return "office_no must be text of at most 30 characters";

  return (
    validateHeight(body.height) ||
    validateWeight(body.weight) ||
    validateBirthdate(body.birthdate) ||
    validateGender(body.gender) ||
    validateCivilStatus(body.civil_status) ||
    validateTinId(body.tin_id) ||
    validateContactNo(body.contact_no) ||
    validateZipCode(body.zip_code) ||
    validateFieldLengths(body, CLIENT_FIELD_LENGTHS) ||
    validateFieldLengths(body, ADDRESS_FIELD_LENGTHS) ||
    validateTextFields(body, CLIENT_TEXT_RULES) ||
    loanShapeProblem(body.loan)
  );
};

// What the invitation lookup adds for the form: the company's plan and, on the credit
// plan, its loan limits and the creditor. A link whose application was already sent is a
// 409, as one already used is; a returned one opens again, to be corrected. `token` is the
// link's, which the invitation row does not carry.
export const invitationExtras = (invitation, token) => {
  if (!devStoreOn()) return {};

  const plan = planFieldsOf(invitation.employer_id);
  if (!isCreditTemplate(plan.plan_template))
    return { plan_template: plan.plan_template, loan_limits: null };

  const sent = applicationOfToken(token);
  if (sent && sent.status !== "returned") throw new AppError("You have already submitted an enrollment", 409);

  return {
    plan_template: plan.plan_template,
    loan_limits: plan.loan_limits,
    creditor_name: invitation.company_name,
  };
};

// The submit of a borrower whose company is on the credit plan: it answers for the
// request, so the usual enrollment never runs (it would make a login and send an email).
// For any other company it passes the request on. `resubmit` is PUT /enrollment/application,
// the same body for a returned application, which has no usual path to pass to (a 404).
export const createCreditSubmission = ({ getPool, resubmit = false }) => async (req, res, next) => {
  if (!devStoreOn()) return next();

  try {
    const token = req.body?.token;
    if (!isInvitationToken(token)) return resubmit ? next(new AppError("Invitation not found", 404)) : next();

    // The lookup finds an invitation whatever the case of its token; the application store
    // keeps and compares the token in lower case, so a second case is not a second link.
    const pool = await getPool();
    const invitation = await InvitationModel.getInvitationByToken(pool, token);

    if (!invitation || !creditCompanyOf(invitation.employer_id))
      return resubmit ? next(new AppError("Invitation not found", 404)) : next();

    if (!invitation.is_valid)
      throw new AppError("This invitation has expired. Please ask your HR to resend it.", 410);
    if (invitation.is_enrolled) throw new AppError("You have already submitted an enrollment", 409);

    const problem = creditProblem(req.body);
    if (problem) throw new AppError(problem, 400);

    // The reads the usual submit makes before it writes anything. Not its company age limit
    // (employers.online_enrollment_max_age): a credit company's age limits are its loan limits.
    const employers = await ReferenceModel.getEmployers(pool);
    if (!employers.some((employer) => String(employer.employer_id) === String(invitation.employer_id)))
      throw new AppError("Invalid or inactive employer", 400);

    if (!(await ReferenceModel.barangayExists(pool, req.body.barangay_id))) throw new AppError("Invalid barangay", 400);
    if (await UserModel.checkUsernameExists(pool, req.body.employee_id_number))
      throw new AppError("Employee ID number already exists", 409);

    const result = submitApplication({ invitation, body: req.body, resubmit });

    return res.status(201).json({
      success: true,
      data: result,
      message: "Application submitted successfully",
    });
  } catch (error) {
    next(error);
  }
};

export default { creditProblem, invitationExtras, createCreditSubmission };
