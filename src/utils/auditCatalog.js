// Which requests the audit trail records, and how.
//
// Every route that creates, changes or deletes something is listed once, either
// in AUDITED_ROUTES or in SKIPPED_ROUTES with the reason. tests/utils/auditCatalog.test.js
// walks the routers and fails for a route that is in neither, so a new endpoint
// cannot go unaudited by being forgotten.
//
// The key is the method and the route as declared, under /api/v1:
// "PATCH /admin/companies/:employer_id".
//
// The rules come from sec.usp_ins_audit_log, which the DBA built and which stays
// the contract (insertAuditLog applies them itself while the procedure cannot
// insert a row; see the note above it):
//   action  one of I, U or D. It refuses anything else, L (login) included.
//   id      the record the action was on, and it must be above zero. The first
//           source that gives one wins: "data.x" is a field of the response's
//           data (for a create, the id it just made), "param.x" a route
//           parameter, and "user" the person acting, which is only for the few
//           actions that have no single record (a bulk send, a job).
//   object  the name shown in the Audit Trail's Module column, 100 characters at most.
const entry = (object, action, ...id) => ({ object, action, id });

export const AUDITED_ROUTES = {
  // ---- Administrator and HR ----
  "POST /admin/invitations": entry("Invitation (bulk send)", "I", "user"),
  "POST /admin/invitations/jobs/:job_id/cancel": entry("Invitation (bulk send)", "U", "user"),
  "POST /admin/invitations/:invitation_id/resend": entry("Invitation", "U", "param.invitation_id"),
  "DELETE /admin/invitations/:invitation_id": entry("Invitation", "D", "param.invitation_id"),

  "POST /admin/enrollments/wipe": entry("Enrollment (development wipe)", "D", "user"),
  "POST /admin/enrollments/:client_id/resend-credentials": entry("Employee account", "U", "param.client_id"),
  "POST /admin/enrollments/:client_id/resend-certificate": entry("Certificate of Coverage", "U", "param.client_id"),
  "POST /admin/enrollments/:client_id/deceased": entry("Deceased status", "U", "param.client_id"),
  "DELETE /admin/enrollments/:client_id/deceased": entry("Deceased status", "D", "param.client_id"),
  "POST /admin/enrollments/:client_id/death-claim": entry("Claim", "I", "data.claim_id", "param.client_id"),
  "POST /admin/enrollments/:client_id/claims": entry("Claim", "I", "data.claim_id", "param.client_id"),

  // The decision names itself and carries what changed (utils/changeRequestAudit.js), because the
  // approve and reject procedures write no audit row. If they ever do, drop that, or the row is twice.
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
  "POST /admin/companies/:employer_id/affiliates": entry("Affiliate", "I", "data.affiliate_id", "param.employer_id"),
  "PATCH /admin/companies/:employer_id/affiliates/:affiliate_id": entry("Affiliate", "U", "param.affiliate_id"),

  "POST /admin/conversations": entry("Conversation", "I", "data.conversation_id"),
  "POST /admin/conversations/:conversation_id/messages": entry("Message", "I", "data.message_id", "param.conversation_id"),
  "POST /admin/conversations/:conversation_id/read": entry("Conversation", "U", "param.conversation_id"),

  // Group Credit Life applications, on the development store (src/gcli).
  "PATCH /admin/enrollment-approvals/:client_id": entry("Enrollment application", "U", "param.client_id"),
  "POST /admin/enrollment-approvals/:client_id/approve": entry("Enrollment application", "U", "param.client_id"),
  "POST /admin/enrollment-approvals/:client_id/return": entry("Enrollment application", "U", "param.client_id"),
  "POST /admin/enrollment-approvals/:client_id/reject": entry("Enrollment application", "U", "param.client_id"),

  // ---- Employee ----
  "POST /employee/change-requests": entry("Profile change request", "I", "data.changeRequestId"),
  "PATCH /employee/change-requests/:request_id/cancel": entry("Profile change request", "U", "param.request_id"),
  "POST /employee/claims": entry("Claim", "I", "data.claim_id"),
  "PATCH /employee/claims/:claim_id/cancel": entry("Claim", "U", "param.claim_id"),
  "POST /employee/claims/:claim_id/resubmit": entry("Claim", "U", "param.claim_id"),
  "POST /employee/conversation": entry("Conversation", "I", "data.conversation_id"),
  "POST /employee/conversations/:conversation_id/messages": entry("Message", "I", "data.message_id", "param.conversation_id"),
  "POST /employee/conversations/:conversation_id/read": entry("Conversation", "U", "param.conversation_id"),
};

// Routes that change things and are deliberately not recorded, and why.
const NO_AUDIT_FOR_LOGIN =
  "sec.usp_ins_audit_log refuses the action L, so a sign-in or sign-out cannot be recorded";
const NO_USER =
  "the person is not signed in, and an audit row needs a user and a session";

export const SKIPPED_ROUTES = {
  "POST /auth/login": NO_AUDIT_FOR_LOGIN,
  "POST /auth/logout": NO_AUDIT_FOR_LOGIN,
  "POST /employee/login": NO_AUDIT_FOR_LOGIN,
  "POST /employee/logout": NO_AUDIT_FOR_LOGIN,
  "POST /auth/change-password": NO_USER,
  "POST /employee/change-password": NO_USER,
  "POST /enrollment/submit": NO_USER,
  "PUT /enrollment/application": NO_USER,
};

export default { AUDITED_ROUTES, SKIPPED_ROUTES };
