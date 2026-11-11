import EmployerModel from "../models/employerModel.js";

// Saving a company's settings: the Certificate of Coverage email, which HR or
// the Administrator changes, and messages_enabled, which only the
// Administrator changes (checked by the controller).
//
// bes.usp_upd_employer_settings takes both settings, mandatory, and writes both
// as given (read on UAT 2026-11-11). So a setting left out is sent as it
// stands, read first from the caller's own list of companies. Until 2026-11-11
// only send_coc_email was sent, and every save was error 201.
//
// Read-then-write is not atomic. An HR save of the COC setting and an
// Administrator save of messaging, landing together, can undo each other.
// DBA request 27 Part 2 makes NULL mean "leave as it is" in the procedure, and
// then the read comes out.

// The caller's list is the procedure's own scoping: the Administrator sees
// every active company, HR its mapped ones. A company missing from it is one
// the update refuses before it writes anything, 50140 or 50141, so the NULL
// sent for it is never stored, and the refusal is left to the procedure.
const updateSettings = async (pool, { employerId, sendCocEmail, messagesEnabled, userId }) => {
  let current;

  if (sendCocEmail === undefined || messagesEnabled === undefined) {
    const companies = await EmployerModel.getEmployerSettings(pool, userId);
    current = companies.find((company) => String(company.employer_id) === String(employerId));
  }

  return EmployerModel.updateEmployerSettings(pool, {
    employerId,
    // A setting left out goes back as it stands, NULL included: HCL's
    // messages_enabled was NULL on 2026-11-11, and inventing a value here
    // would change a setting nobody asked to change.
    sendCocEmail: sendCocEmail ?? current?.send_coc_email ?? null,
    messagesEnabled: messagesEnabled ?? current?.messages_enabled ?? null,
    userId,
  });
};

export default { updateSettings };
