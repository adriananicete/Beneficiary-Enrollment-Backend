import ClientModel from "../models/clientModel.js";
import InvitationModel from "../models/invitationModel.js";
import ChangeRequestModel from "../models/changeRequestModel.js";
import { SUPER_ADMIN } from "../utils/constants.js";

// Two dashboards, because the two roles do different jobs.
//
// An Administrator oversees every company and works no queue. An HR runs one
// company and works three: who has not enrolled, what is waiting for a
// decision, and which invitations failed to send. Settled 2026-09-07.
//
// The counts are not invented to fill a screen. Each one is already asked for
// somewhere in the system — the is_enrolled = 0 list is called the only list
// HR can act on in BUSINESS-REQUIREMENTS §3.6, the pending count already has
// its own endpoint driving a nav badge, and failed sends are what HR chases.
//
// Every count reads through a procedure that already exists and already
// carries the company scoping: usp_sel_hr_employees,
// usp_sel_enrollment_invitations_by_user and
// usp_sel_client_change_request_pending_count. No new procedure was requested
// and no raw query was written.
//
// That was the constraint rather than a convenience. Company scoping is an
// access rule, and a raw query reproducing it is a second implementation of it
// — which is why getOwnershipIds was deleted in PR #56 and why the Excel export
// reads through usp_sel_hr_employees rather than a query of its own. A
// dashboard is a screen rather than a file, but the rule is the same.

// Grouped on company_code, which is the only company key
// usp_sel_hr_employees returns — the projection carries company_code and
// company_name but not employer_id.
//
// KNOWN GAP: a company with no employee rows at all does not appear here, so a
// newly onboarded company shows as absent rather than as zero — which is
// exactly when somebody would want to see the zero. A company that has
// employees but no enrollments does show 0, because those rows are a LEFT JOIN
// miss rather than a missing row.
//
// The fix is to read the employer list and fill the gaps from it. Not done
// here because usp_sel_employers has never been read in this project and its
// columns would be a guess — and because it is unscoped, so it must never be
// used on the HR branch below.
const countByCompany = (employees) => {
  const byCode = new Map();

  for (const row of employees) {
    const existing = byCode.get(row.company_code) ?? {
      company_code: row.company_code,
      company_name: row.company_name,
      enrolled: 0,
    };

    if (row.enrollment_id != null) existing.enrolled += 1;

    byCode.set(row.company_code, existing);
  }

  return [...byCode.values()].sort((a, b) =>
    String(a.company_name).localeCompare(String(b.company_name)),
  );
};

// page_size 1 rather than the whole set. COUNT(*) OVER() is computed before
// OFFSET/FETCH, so total_count is the count of everything matching the filter
// regardless of how few rows come back.
//
// Only reachable on the HR branch. usp_sel_enrollment_invitations_by_user
// throws 50073 for any caller who is not HR — it checks
// r.us02_role_name = 'HR' with no Administrator branch, unlike every other
// list procedure. That is the open question in PARK.md §3, and it no longer
// costs us anything here: an Administrator has no use for these two counts.
const invitationCounts = async (pool, userId) => {
  const [awaiting] = await InvitationModel.getInvitationsByUser(pool, userId, {
    page: 1,
    pageSize: 1,
    isEnrolled: 0,
    status: "A",
  });

  const [failed] = await InvitationModel.getInvitationsByUser(pool, userId, {
    page: 1,
    pageSize: 1,
    sendStatus: "failed",
    status: "A",
  });

  // No rows at all means the count is genuinely zero — there is no total_count
  // to read from an empty result set.
  return {
    awaitingEnrollment: awaiting?.total_count ?? 0,
    failedInvitations: failed?.total_count ?? 0,
  };
};

const getStats = async (pool, { user_id, role_name }) => {
  // page_size undefined reaches the procedure as NULL, which means every row.
  // For an Administrator that is every company, because usp_sel_hr_employees
  // skips the employer filter for them.
  //
  // Counting needs the rows rather than total_count: the procedure counts
  // employees, not enrollments, so an employee whose enrollment row is missing
  // is a LEFT JOIN miss that total_count would include. At a few hundred
  // clients this costs nothing. If it ever becomes slow the fix is a counting
  // procedure from the DBA, not a raw query here.
  const employees = await ClientModel.getHrEmployees(pool, user_id);

  const enrolled = employees.filter((row) => row.enrollment_id != null).length;

  // `scope` is here so the frontend can branch on a field rather than sniff
  // which keys arrived. Two shapes from one endpoint is worth saying out loud.
  if (role_name === SUPER_ADMIN)
    return {
      scope: "all-companies",
      enrolled,
      byCompany: countByCompany(employees),
    };

  const pendingChangeRequests = await ChangeRequestModel.getPendingCountByUser(
    pool,
    user_id,
  );

  const { awaitingEnrollment, failedInvitations } = await invitationCounts(
    pool,
    user_id,
  );

  return {
    scope: "company",
    enrolled,
    awaitingEnrollment,
    pendingChangeRequests,
    failedInvitations,
  };
};

export default { getStats };
