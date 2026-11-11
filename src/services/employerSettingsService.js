import EmployerModel from "../models/employerModel.js";

// Saving a company's settings. One is changed from here today, the
// Certificate of Coverage email; messages_enabled sits beside it.
//
// bes.usp_upd_employer_settings takes both settings, mandatory, and writes both
// as given (read on UAT 2026-11-11). So saving one means sending the other as
// it stands, and that is read first, from the caller's own list of companies.
// Until 2026-11-11 only send_coc_email was sent, and every save was error 201.
//
// Read-then-write is not atomic: a save of the other setting landing between
// the two would be undone. Nothing changes messages_enabled from the
// application yet. DBA request 27 Part 2 makes NULL mean "leave as it is" in
// the procedure, and then this read comes out.

// The caller's list is the procedure's own scoping: the Administrator sees
// every active company, HR its mapped ones. A company missing from it is one
// the update refuses before it writes anything, 50140 or 50141, so the NULL
// sent for it is never stored, and the refusal is left to the procedure.
const updateSettings = async (pool, { employerId, sendCocEmail, userId }) => {
  const companies = await EmployerModel.getEmployerSettings(pool, userId);
  const current = companies.find((company) => String(company.employer_id) === String(employerId));

  return EmployerModel.updateEmployerSettings(pool, {
    employerId,
    sendCocEmail,
    // As it stands, NULL included: HCL's was NULL on 2026-11-11, and inventing
    // a value here would change a setting nobody asked to change.
    messagesEnabled: current?.messages_enabled ?? null,
    userId,
  });
};

export default { updateSettings };
