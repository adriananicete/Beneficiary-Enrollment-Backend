// Whether a caller may use messaging, the company switch in
// bes.employers.messages_enabled. One rule, used by the REST gate
// (requireCompanyMessaging), by GET /messaging-access, and by the socket server,
// so the screen shows the chat exactly when the routes allow it.
//
// The rule, decided with Adrian 2026-11-11: **every company the caller belongs
// to has messaging on, and there is at least one.** HR belongs to its mapped
// companies, an employee to their current employer; each is one company today,
// so in practice it reads "your company has messaging on".
//
// "Every", not "any". The teammates' version let a caller through when any one
// of their companies was on, so an HR account mapped to two companies would
// keep messaging a company the Administrator had switched off. With "every",
// that account is refused for both until the mapping or the setting is
// settled: shut rather than open. Which company a conversation belongs to is
// not in the list or the unread count, so a per-conversation rule would need
// the procedures changed.
//
// `rows` is bes.usp_sel_messaging_access_by_user's answer: one row per company,
// with messages_enabled already NULL-as-0.

// A BIT arrives as true/false, and NULL as null, which is off.
export const isOn = (value) => value === true || value === 1;

export const messagingAllowed = (rows) =>
  Array.isArray(rows) && rows.length > 0 && rows.every((row) => isOn(row.messages_enabled));

export const MESSAGING_OFF = "Messaging is disabled for this company.";

export default { isOn, messagingAllowed, MESSAGING_OFF };
