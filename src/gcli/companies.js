import PlanModel from "../models/planModel.js";
import { AppError } from "../utils/AppError.js";
import { devStoreOn, readStore, update } from "./devStore.js";
import { limitsOf, limitsProblem } from "./loanRules.js";

// A company's plan and loan limits (docs/backend-handoff.md 2.12 A), kept in the dev
// store because dbo.employers has no plan column. A company with nothing stored is on
// the standard plan, as every company is today.

export const CREDIT_TEMPLATE = "G-CLI";

export const isCreditTemplate = (template) =>
  String(template ?? "").trim().toUpperCase() === CREDIT_TEMPLATE;

const STANDARD_PLAN = {
  plan_code: "GTLIP",
  plan_desc: "Group Term Life Insurance Plan",
  plan_template: "G-TLI",
};

// One plan as the Administrator's dropdown reads it. The credit plan is shown as
// switched on while the dev store is: in the database it is off until the DBA switches
// it on (docs/backend-handoff.md 2.12 A), and without this it could not be chosen to
// try the feature. Every other plan is as the table has it.
const planOf = (row) => ({
  plan_id: row.plan_id,
  plan_code: row.plan_code,
  plan_desc: row.plan_desc,
  template: row.template,
  is_active: Boolean(row.is_active) || isCreditTemplate(row.template),
});

export const getPlans = async (pool) => (await PlanModel.getPlans(pool)).map(planOf);

const storedPlan = (store, employerId) => store.companies[String(employerId)];

const hasApplicationsIn = (store, employerId) =>
  store.applications.some((application) => String(application.employer_id) === String(employerId));

// What a company row gains: its plan, whether the plan can still change (not once the
// company has an enrollment or an application) and, on the credit plan, its limits.
export const planFieldsOf = (employerId, enrollmentExists = false) => {
  const store = readStore();
  const own = storedPlan(store, employerId);
  const plan = own ?? STANDARD_PLAN;

  return {
    plan_code: plan.plan_code,
    plan_desc: plan.plan_desc,
    plan_template: plan.plan_template,
    plan_locked: Boolean(enrollmentExists) || hasApplicationsIn(store, employerId),
    loan_limits: isCreditTemplate(plan.plan_template) ? own?.loan_limits ?? null : null,
  };
};

// The credit plan's company, or null for any other (and always null with the dev store off).
export const creditCompanyOf = (employerId) => {
  if (!devStoreOn()) return null;

  const fields = planFieldsOf(employerId);
  return isCreditTemplate(fields.plan_template) ? fields : null;
};

// The plan and the limits an Administrator sent, taken out of the body before the
// company rules see it (they refuse any field a company does not have) and checked here.
// Left on the request as `req.plan`: { plan: { plan_code, plan_desc, plan_template } } and/or
// { loan_limits } (null clears them). Does nothing with the dev store off, and then the
// company rules refuse the two fields as they always did.
export const takePlanFields = (getPool) => async (req, res, next) => {
  if (!devStoreOn()) return next();

  try {
    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) return next();

    const { plan_code, loan_limits } = body;
    if (plan_code === undefined && loan_limits === undefined) return next();

    delete body.plan_code;
    delete body.loan_limits;

    const taken = {};

    if (plan_code !== undefined) {
      if (typeof plan_code !== "string" || plan_code.trim() === "")
        throw new AppError("plan_code must be text", 400);

      const found = (await getPlans(await getPool())).find((plan) => plan.plan_code === plan_code.trim());
      if (!found) throw new AppError("That plan does not exist", 400);
      if (!found.is_active) throw new AppError("That plan is not switched on", 409);

      taken.plan = { plan_code: found.plan_code, plan_desc: found.plan_desc, plan_template: found.template };
    }

    if (loan_limits !== undefined) {
      if (loan_limits === null) {
        taken.loan_limits = null;
      } else {
        const problem = limitsProblem(loan_limits);
        if (problem) throw new AppError(problem, 400);
        taken.loan_limits = limitsOf(loan_limits);
      }
    }

    req.plan = taken;
    next();
  } catch (error) {
    next(error);
  }
};

// Whether `taken` may be applied to the company: the plan cannot change once the company
// has an enrollment (409), and loan limits belong to the credit plan only (400). Asked
// before the company is written, so a refusal leaves nothing half done. A company that
// does not exist yet (employerId null) starts on the standard plan.
export const assertPlanChange = (employerId, taken, enrollmentExists = false) => {
  const store = readStore();
  const current = (employerId != null && storedPlan(store, employerId)) || STANDARD_PLAN;

  const changing = taken.plan && taken.plan.plan_code !== current.plan_code;
  if (changing && (enrollmentExists || (employerId != null && hasApplicationsIn(store, employerId))))
    throw new AppError("The plan cannot change once the company has an enrollment", 409);

  const template = taken.plan ? taken.plan.plan_template : current.plan_template;
  if (taken.loan_limits && !isCreditTemplate(template))
    throw new AppError("Loan limits belong to the credit plan only", 400);
};

export const savePlan = (employerId, taken) =>
  update((store) => {
    const key = String(employerId);
    const own = store.companies[key] ?? { ...STANDARD_PLAN, loan_limits: null };

    if (taken.plan) Object.assign(own, taken.plan);
    if ("loan_limits" in taken) own.loan_limits = taken.loan_limits;

    store.companies[key] = own;
  });

// What /auth/me tells the menu about each of HR's companies: its plan.
export const withPlans = (user) =>
  !devStoreOn() || !Array.isArray(user?.employers)
    ? user
    : {
        ...user,
        employers: user.employers.map((employer) => {
          const { plan_code, plan_template } = planFieldsOf(employer.employer_id);
          return { ...employer, plan_code, plan_template };
        }),
      };

export default { getPlans, planFieldsOf, creditCompanyOf, takePlanFields, assertPlanChange, savePlan, withPlans };
