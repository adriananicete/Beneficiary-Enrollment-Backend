import EmployerModel from "../models/employerModel.js";

// Saving a company's settings: the Certificate of Coverage email, which HR or
// the Administrator changes, and messages_enabled, which only the
// Administrator changes (checked by the controller, and by the procedure as
// 50223).
//
// bes.usp_upd_employer_settings takes both settings with NULL meaning "leave
// as it is" (DBA request 27 Part 2, read back 2026-11-11). So a setting left
// out is sent as NULL, and the procedure keeps what is stored, in the same
// UPDATE.
//
// Until then both were mandatory and written as given, so the one left out
// was read first and sent back. That read is gone, and with it the race it
// carried: an HR save of the COC setting and an Administrator save of
// messaging, landing together, could undo each other.
const updateSettings = async (pool, { employerId, sendCocEmail, messagesEnabled, userId }) =>
  EmployerModel.updateEmployerSettings(pool, {
    employerId,
    sendCocEmail: sendCocEmail ?? null,
    messagesEnabled: messagesEnabled ?? null,
    userId,
  });

export default { updateSettings };
