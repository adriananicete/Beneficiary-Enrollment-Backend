// Which requests the audit trail records, and how (DBA request 34, part B of the
// audit work). Ported from the teammates' catalog and rebuilt for this API's
// routes.
//
// Every route that creates, changes or deletes something is listed once: in
// AUDITED_ROUTES, or in SKIPPED_ROUTES with the reason. tests/utils/auditCatalog.test.js
// walks the routers and fails for a write route in neither, so a new endpoint
// cannot go unaudited by being forgotten.
//
// The key is the method and the route as declared, under /api/v1:
// "PATCH /admin/companies/:employer_id".
//
//   object  the module, as the Audit Trail's list shows it (100 characters at most)
//   action  I, U or D
//   id      where the record's id is found, the first that gives a whole number
//           above zero: "data.x" a field of the response's data (for a create,
//           the id it just made), "param.x" a route parameter. None for an
//           action on no single record (a bulk send, a job): the row then has no
//           record id.
const entry = (object, action, ...id) => ({ object, action, id });

export const AUDITED_ROUTES = {
  // ---- HR and the Administrator ----
  "POST /admin/invitations": entry("Invitation (bulk send)", "I"),
  "POST /admin/invitations/jobs/:job_id/cancel": entry("Invitation (bulk send)", "U"),
  "POST /admin/invitations/:invitation_id/resend": entry("Invitation", "U", "param.invitation_id"),
  "DELETE /admin/invitations/:invitation_id": entry("Invitation", "D", "param.invitation_id"),

  "POST /admin/enrollments/wipe": entry("Enrollment (development wipe)", "D"),
  "POST /admin/enrollments/:client_id/resend-credentials": entry("Employee account", "U", "param.client_id"),
  "POST /admin/enrollments/:client_id/resend-certificate": entry("Certificate of Coverage", "U", "param.client_id"),
  "POST /admin/enrollments/:client_id/deceased": entry("Deceased status", "U", "param.client_id"),
  "DELETE /admin/enrollments/:client_id/deceased": entry("Deceased status", "D", "param.client_id"),
  "POST /admin/enrollments/:client_id/death-claim": entry("Claim", "I", "data.claim_id", "param.client_id"),

  // The decision carries what changed (changeRequestAudit.js): the approve and
  // reject procedures write no audit row of their own.
  "PATCH /admin/change-requests/:request_id": entry("Profile change request", "U", "param.request_id"),
  "PATCH /admin/claims/:claim_id": entry("Claim", "U", "param.claim_id"),
  "PATCH /admin/claims/:claim_id/close": entry("Claim", "U", "param.claim_id"),

  "PATCH /admin/employers/:employer_id/settings": entry("Company settings", "U", "param.employer_id"),
  "POST /admin/companies": entry("Company", "I", "data.employer_id"),
  "PATCH /admin/companies/:employer_id": entry("Company", "U", "param.employer_id"),
  "DELETE /admin/companies/:employer_id": entry("Company", "D", "param.employer_id"),
  "POST /admin/companies/:employer_id/classifications": entry("Classification", "I", "data.classification_id", "param.employer_id"),
  "PATCH /admin/companies/:employer_id/classifications/:classification_id": entry("Classification", "U", "param.classification_id"),
  "POST /admin/companies/:employer_id/hr-account": entry("HR account", "I", "data.user_id", "param.employer_id"),
  "POST /admin/companies/:employer_id/hr-account/resend-credentials": entry("HR account", "U", "param.employer_id"),
  "POST /admin/companies/:employer_id/hr-account/:user_id/resend-credentials": entry("HR account", "U", "param.user_id"),
  "POST /admin/companies/:employer_id/affiliates": entry("Affiliate", "I", "data.affiliate_id", "param.employer_id"),
  "PATCH /admin/companies/:employer_id/affiliates/:affiliate_id": entry("Affiliate", "U", "param.affiliate_id"),

  "POST /admin/conversations": entry("Conversation", "I", "data.conversation_id"),
  "POST /admin/conversations/:conversation_id/messages": entry("Message", "I", "data.message_id"),
  "POST /admin/conversations/:conversation_id/attachments": entry("Message attachment", "I", "data.message_id"),
  "PATCH /admin/conversations/:conversation_id/messages/:message_id": entry("Message", "U", "param.message_id"),

  // ---- Employee ----
  "POST /employee/change-requests": entry("Profile change request", "I", "data.changeRequestId"),
  "PATCH /employee/change-requests/:request_id/cancel": entry("Profile change request", "U", "param.request_id"),
  "POST /employee/claims": entry("Claim", "I", "data.claim_id"),
  "PATCH /employee/claims/:claim_id/cancel": entry("Claim", "U", "param.claim_id"),
  "POST /employee/claims/:claim_id/resubmit": entry("Claim", "U", "param.claim_id"),
  "POST /employee/conversation": entry("Conversation", "I", "data.conversation_id"),
  "POST /employee/conversations/:conversation_id/messages": entry("Message", "I", "data.message_id"),
  "POST /employee/conversations/:conversation_id/attachments": entry("Message attachment", "I", "data.message_id"),
  "PATCH /employee/conversations/:conversation_id/messages/:message_id": entry("Message", "U", "param.message_id"),
};

// Write routes deliberately not recorded here, and why.
const IN_THE_SECURITY_LOG = "a sign-in, sign-out or password change is recorded in the security log (sec.us09_security_events)";
const NOT_SIGNED_IN = "the person is not signed in yet, and an audit row names who acted";
const READ_MARKER = "a read marker moves every time a conversation is looked at; it changes no record anybody manages";

export const SKIPPED_ROUTES = {
  "POST /auth/login": IN_THE_SECURITY_LOG,
  "POST /auth/logout": IN_THE_SECURITY_LOG,
  "POST /auth/change-password": IN_THE_SECURITY_LOG,
  "POST /employee/login": IN_THE_SECURITY_LOG,
  "POST /employee/logout": IN_THE_SECURITY_LOG,
  "POST /employee/change-password": IN_THE_SECURITY_LOG,
  "POST /enrollment/submit": NOT_SIGNED_IN,
  "POST /admin/conversations/:conversation_id/read": READ_MARKER,
  "POST /employee/conversations/:conversation_id/read": READ_MARKER,
};

export default { AUDITED_ROUTES, SKIPPED_ROUTES };
