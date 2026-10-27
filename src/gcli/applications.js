import { AppError } from "../utils/AppError.js";
import { fullName } from "../utils/fullName.js";
import { localIsoDate } from "../utils/localDate.js";
import { normaliseContactNo, validateContactNo } from "../utils/validateContactNo.js";
import { creditCompanyOf } from "./companies.js";
import { readStore, update } from "./devStore.js";
import { checkLoan, parseDay, wholeNumber } from "./loanRules.js";

// A Group Credit Life borrower's application and HR's decision on it
// (docs/backend-handoff.md 2.12 B and C), kept in the dev store. An application is
// pending until HR approves, returns or rejects it, and approving makes no login and
// sends no email: those need the database.

// A client_id for an application is far above any real one, so the Dashboard's rows and
// View Details can tell the two apart and neither is mistaken for the other.
const CLIENT_ID_BASE = 900_000_000_000;

export const isApplicationId = (value) => {
  const id = Number(value);
  return /^\d{12}$/.test(String(value)) && id >= CLIENT_ID_BASE && id < CLIENT_ID_BASE * 2;
};

// The tabs of the approvals page and the status each stands for.
const STATUS_OF_TAB = { waiting: "pending", returned: "returned", approved: "approved", rejected: "rejected" };

// A link's token and an employee ID are compared without regard to case: the invitation lookup
// and the login name both are, so "AAAA" must not be a second link, or "emp-1" a second person.
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

// What the Dashboard's status column shows for an application.
const DASHBOARD_STATUS = { pending: "P", returned: "R", approved: "A", rejected: "X" };

const NOTE_MAX = 500;

// The personal fields kept from the form. The rest of the body (consent, the employer the
// form named) is not part of the record.
const EMPLOYEE_FIELDS = [
  "employee_id_number",
  "first_name",
  "middle_name",
  "last_name",
  "suffix",
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
  "office_no",
];

const pick = (source, fields) =>
  Object.fromEntries(fields.filter((field) => source[field] !== undefined).map((field) => [field, source[field]]));

const loanOf = (loan) => ({
  loan_reference: loan.loan_reference,
  purpose: loan.purpose,
  loan_amount: Number(loan.loan_amount),
  term_months: Number(loan.term_months),
  release_date: loan.release_date,
});

const limitsOfCompany = (employerId) => creditCompanyOf(employerId)?.loan_limits ?? null;

const refuseLoan = (reasons) => {
  throw new AppError(reasons.join(" "), 422);
};

const applicationNumber = (store, now) => {
  store.lastApplication += 1;
  return {
    sequence: store.lastApplication,
    applicationNo: `GCLI-${now.getFullYear()}-${String(store.lastApplication).padStart(4, "0")}`,
  };
};

const historyEntry = (now, by, action, note = null, extra = {}) => ({
  at: now.toISOString(),
  by,
  action,
  note,
  ...extra,
});

// The borrower's application, from a form that has passed the field rules
// (creditSubmission.js). `invitation` is the row behind the link: the company and the
// email are its, never the form's. A returned application on the same link is replaced and
// goes back to pending; any other one already there is a 409. `resubmit` is the PUT: it
// needs a returned application to replace. Answers { application_no, status }.
export const submitApplication = ({ invitation, body, resubmit = false, now = new Date() }) => {
  const limits = limitsOfCompany(invitation.employer_id);
  if (!limits) throw new AppError("This company has not set its loan limits yet. Please contact your HR.", 409);

  const loan = loanOf(body.loan);
  const checked = checkLoan(limits, loan, body.birthdate, invitation.company_name);
  if (checked.reasons.length > 0) refuseLoan(checked.reasons);

  return update((store) => {
    const employee = { ...pick(body, EMPLOYEE_FIELDS), email_address: invitation.email_address };
    const token = String(body.token).toLowerCase();
    const existing = store.applications.find((application) => application.token === token);

    if (existing && existing.status !== "returned")
      throw new AppError("You have already submitted an enrollment", 409);
    if (resubmit && !existing) throw new AppError("There is no returned application to correct on this link", 409);

    if (
      store.applications.some(
        (application) =>
          application !== existing &&
          application.status !== "rejected" &&
          same(application.employee.employee_id_number, employee.employee_id_number),
      )
    )
      throw new AppError("Employee ID number already exists", 409);

    if (existing) {
      Object.assign(existing, {
        status: "pending",
        submitted_date: now.toISOString(),
        employee,
        loan,
      });
      existing.history.push(historyEntry(now, employee.email_address, "submitted", "Sent again after it was returned"));
      return { application_no: existing.application_no, status: "pending" };
    }

    const { sequence, applicationNo } = applicationNumber(store, now);
    store.applications.push({
      client_id: String(CLIENT_ID_BASE + sequence),
      application_no: applicationNo,
      token,
      employer_id: String(invitation.employer_id),
      company_name: invitation.company_name,
      status: "pending",
      submitted_date: now.toISOString(),
      effectivity_date: null,
      maturity_date: null,
      employee,
      loan,
      history: [historyEntry(now, employee.email_address, "submitted")],
    });

    return { application_no: applicationNo, status: "pending" };
  });
};

// The application behind an invitation link, if the borrower already sent one.
export const applicationOfToken = (token) =>
  readStore().applications.find((application) => application.token === String(token).toLowerCase());

const ownedBy = (employerIds) => (application) => employerIds.map(String).includes(String(application.employer_id));

const find = (store, clientId, employerIds) => {
  const found = isApplicationId(clientId)
    ? store.applications.find((application) => application.client_id === String(clientId))
    : undefined;
  if (!found || !ownedBy(employerIds)(found)) throw new AppError("Application not found", 404);
  return found;
};

// ---- HR's queue -----------------------------------------------------------------

const rowOf = (application) => ({
  client_id: application.client_id,
  application_no: application.application_no,
  employee_name: fullName(application.employee),
  email_address: application.employee.email_address,
  employee_id_number: application.employee.employee_id_number,
  loan_reference: application.loan.loan_reference,
  loan_amount: application.loan.loan_amount,
  term_months: application.loan.term_months,
  above_no_medical_limit: aboveNoMedical(application),
  status: application.status,
  submitted_date: application.submitted_date,
});

const aboveNoMedical = (application) => {
  const limit = limitsOfCompany(application.employer_id)?.no_medical_limit;
  return limit != null && application.loan.loan_amount > limit;
};

const newestFirst = (a, b) => (a.submitted_date < b.submitted_date ? 1 : a.submitted_date > b.submitted_date ? -1 : 0);

// `tab` is waiting, returned, approved or rejected; anything else is a 400.
export const listApplications = ({ employerIds, tab, page, pageSize }) => {
  const status = Object.hasOwn(STATUS_OF_TAB, tab) ? STATUS_OF_TAB[tab] : undefined;
  if (!status) throw new AppError("status must be waiting, returned, approved or rejected", 400);

  const all = readStore()
    .applications.filter((application) => ownedBy(employerIds)(application) && application.status === status)
    .sort(newestFirst);

  const start = (page - 1) * pageSize;

  return {
    rows: all.slice(start, start + pageSize).map(rowOf),
    page,
    pageSize,
    total: all.length,
    totalPages: Math.ceil(all.length / pageSize),
  };
};

export const pendingApplicationCount = (employerIds) =>
  readStore().applications.filter((application) => ownedBy(employerIds)(application) && application.status === "pending")
    .length;

// The whole application, as the Review window reads it.
const detailOf = (application) => ({
  client_id: application.client_id,
  application_no: application.application_no,
  status: application.status,
  submitted_date: application.submitted_date,
  company_name: application.company_name,
  creditor_name: application.company_name,
  ...(application.effectivity_date ? { effectivity_date: application.effectivity_date } : {}),
  loan_limits: limitsOfCompany(application.employer_id),
  employee: {
    full_name: fullName(application.employee),
    birthdate: application.employee.birthdate,
    employee_id_number: application.employee.employee_id_number,
    email_address: application.employee.email_address,
    contact_no: application.employee.contact_no,
    office_no: application.employee.office_no ?? null,
    address_line: application.employee.address_line,
  },
  loan: application.loan,
  history: application.history,
});

export const getApplication = (clientId, employerIds) => detailOf(find(readStore(), clientId, employerIds));

// ---- HR edits ---------------------------------------------------------------------

const EDITABLE = ["contact_no", "office_no", "address_line", "loan"];
const LOAN_FIELDS = ["loan_reference", "purpose", "loan_amount", "term_months", "release_date"];

const reasonOf = (value, what) => {
  const text = typeof value === "string" ? value.trim() : "";
  if (text === "") throw new AppError(`${what} is required`, 400);
  if (text.length > NOTE_MAX) throw new AppError(`${what} must not exceed ${NOTE_MAX} characters`, 400);
  return text;
};

// One field of the contact block, normalised and checked. Throws a 400 sentence.
const contactChange = (field, value) => {
  if (field === "contact_no") {
    const contact = normaliseContactNo(value);
    const problem = validateContactNo(contact);
    if (problem) throw new AppError(problem, 400);
    return contact;
  }

  if (field === "office_no") {
    if (value === null || value === "") return null;
    if (typeof value !== "string" || value.trim().length > 30)
      throw new AppError("office_no must be text of at most 30 characters, or null to clear it", 400);
    return value.trim();
  }

  if (typeof value !== "string" || value.trim() === "" || value.trim().length > 255)
    throw new AppError("address_line is required and must not exceed 255 characters", 400);
  return value.trim();
};

const loanChange = (current, sent) => {
  if (!sent || typeof sent !== "object" || Array.isArray(sent)) throw new AppError("loan must be an object", 400);

  const unknown = Object.keys(sent).find((key) => !LOAN_FIELDS.includes(key));
  if (unknown) throw new AppError(`${unknown} is not a loan field`, 400);

  for (const field of ["loan_reference", "purpose"]) {
    if (field in sent && (typeof sent[field] !== "string" || sent[field].trim() === "" || sent[field].trim().length > 100))
      throw new AppError(`${field} is required and must not exceed 100 characters`, 400);
  }
  if (sent.loan_reference && sent.loan_reference.trim().length > 30)
    throw new AppError("loan_reference must not exceed 30 characters", 400);

  for (const field of ["loan_amount", "term_months"]) {
    if (field in sent && wholeNumber(sent[field]) === null)
      throw new AppError(`${field} must be a whole number of up to 9 digits`, 400);
  }
  if ("release_date" in sent && !parseDay(sent.release_date))
    throw new AppError("release_date must be a date (YYYY-MM-DD)", 400);

  return loanOf({
    ...current,
    ...sent,
    ...(sent.loan_reference !== undefined ? { loan_reference: sent.loan_reference.trim() } : {}),
    ...(sent.purpose !== undefined ? { purpose: sent.purpose.trim() } : {}),
  });
};

// HR corrects a waiting application. `changes` holds only what changed (contact_no,
// office_no, address_line and a loan object); `reason` says why. The name, birth date and
// email are the borrower's own and are refused. The loan is checked against the company's
// limits as it will be saved. Answers the application as the Review window reads it.
export const editApplication = ({ clientId, employerIds, changes, reason, by, now = new Date() }) => {
  if (!changes || typeof changes !== "object" || Array.isArray(changes))
    throw new AppError("changes must be an object", 400);

  const note = reasonOf(reason, "reason");

  const unknown = Object.keys(changes).find((key) => !EDITABLE.includes(key));
  if (unknown) throw new AppError(`${unknown} cannot be changed here`, 400);

  return update((store) => {
    const application = find(store, clientId, employerIds);
    if (application.status !== "pending") throw new AppError("Only a waiting application can be edited", 409);

    const touched = [];
    const record = (field, before, after) => {
      if (JSON.stringify(before ?? null) !== JSON.stringify(after ?? null)) touched.push({ field, before: before ?? null, after });
    };

    const employee = { ...application.employee };
    for (const field of ["contact_no", "office_no", "address_line"]) {
      if (!(field in changes)) continue;
      employee[field] = contactChange(field, changes[field]);
      record(field, application.employee[field], employee[field]);
    }

    let loan = application.loan;
    if ("loan" in changes) {
      loan = loanChange(application.loan, changes.loan);
      for (const field of LOAN_FIELDS) record(`loan.${field}`, application.loan[field], loan[field]);

      const limits = limitsOfCompany(application.employer_id);
      if (limits) {
        const checked = checkLoan(limits, loan, employee.birthdate, application.company_name);
        if (checked.reasons.length > 0) refuseLoan(checked.reasons);
      }
    }

    if (touched.length === 0) throw new AppError("Nothing to change", 400);

    application.employee = employee;
    application.loan = loan;
    application.history.push(historyEntry(now, by, "edited", note, { changes: touched }));

    return detailOf(application);
  });
};

// ---- HR decides ------------------------------------------------------------------

// approve, return or reject a waiting application. Approving needs the day the cover
// starts (a day already past is allowed) and checks the loan against the company's
// limits as they are now; returning and rejecting need a note for the borrower. Makes no
// login and sends nothing. Answers { client_id, status }.
export const decideApplication = ({ clientId, employerIds, action, effectivityDate, note, by, now = new Date() }) =>
  update((store) => {
    const application = find(store, clientId, employerIds);
    if (application.status !== "pending") throw new AppError("This application has already been decided", 409);

    if (action === "approve") {
      if (!parseDay(effectivityDate)) throw new AppError("effectivity_date must be a date (YYYY-MM-DD)", 400);

      // Limits cleared since the borrower applied: nothing to check the loan against, so it
      // is not approved on trust (a submit is refused in the same case).
      const limits = limitsOfCompany(application.employer_id);
      if (!limits) throw new AppError("This company has not set its loan limits yet", 409);

      const checked = checkLoan(limits, application.loan, application.employee.birthdate, application.company_name);
      if (checked.reasons.length > 0) refuseLoan(checked.reasons);
      application.maturity_date = checked.maturityDate;

      application.status = "approved";
      application.effectivity_date = effectivityDate;
      application.history.push(historyEntry(now, by, "approved"));
    } else {
      application.status = action === "return" ? "returned" : "rejected";
      application.history.push(historyEntry(now, by, application.status, reasonOf(note, "note")));
    }

    return { client_id: application.client_id, status: application.status };
  });

// ---- the Dashboard ----------------------------------------------------------------

// An application as a row of HR's enrollment list: P waiting, R returned, X rejected, A approved.
const dashboardRowOf = (application) => ({
  client_id: application.client_id,
  enrollment_id: null,
  first_name: application.employee.first_name,
  middle_name: application.employee.middle_name ?? null,
  last_name: application.employee.last_name,
  suffix: application.employee.suffix ?? null,
  employee_id_number: application.employee.employee_id_number,
  company_name: application.company_name,
  classification_desc: null,
  email_address: application.employee.email_address,
  status: DASHBOARD_STATUS[application.status],
  // the day in Philippine time, not toISOString's UTC day (yesterday before eight in the morning)
  enrollment_date: localIsoDate(new Date(application.submitted_date)),
  loan_amount: application.loan.loan_amount,
  effectivity_date: application.effectivity_date,
});

const matches = (application, search) => {
  if (!search) return true;
  const needle = search.toLowerCase();
  return [fullName(application.employee), application.employee.employee_id_number, application.employee.email_address].some((text) =>
    String(text ?? "").toLowerCase().includes(needle),
  );
};

// HR's page of the enrollment list with the company's applications put in front of it.
// `page` is the usual { rows, page, pageSize, total, totalPages }; applications ride on
// page 1 (there are few, and the page can be a few rows longer than its size), and the
// total counts them. Left as it was when HR's companies have none.
export const withApplications = (page, { employerIds, search }) => {
  const own = readStore()
    .applications.filter((application) => ownedBy(employerIds)(application) && matches(application, search))
    .sort(newestFirst);

  if (own.length === 0) return page;

  const total = page.total + own.length;

  return {
    ...page,
    rows: page.page === 1 ? [...own.map(dashboardRowOf), ...page.rows] : page.rows,
    total,
    // applications ride on page 1, so they add no page of their own
    totalPages: Math.max(page.totalPages, 1),
  };
};

// View Details of an application: the row, and what the borrower filled in.
export const applicationDetails = (clientId, employerIds) => {
  const application = find(readStore(), clientId, employerIds);

  return {
    enrollment: [
      {
        ...dashboardRowOf(application),
        ...pick(application.employee, ["birthdate", "gender", "civil_status", "contact_no", "office_no", "address_line", "zip_code"]),
        plan_template: "G-CLI",
        application_no: application.application_no,
        maturity_date: application.maturity_date,
        loan_reference: application.loan.loan_reference,
        loan_purpose: application.loan.purpose,
        loan_term_months: application.loan.term_months,
        loan_release_date: application.loan.release_date,
        creditor_name: application.company_name,
      },
    ],
    beneficiaries: [],
    benefits: [],
  };
};

export default {
  isApplicationId,
  submitApplication,
  applicationOfToken,
  listApplications,
  pendingApplicationCount,
  getApplication,
  editApplication,
  decideApplication,
  withApplications,
  applicationDetails,
};
