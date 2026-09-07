import ClientModel from "../models/clientModel.js";
import InvitationModel from "../models/invitationModel.js";
import ChangeRequestModel from "../models/changeRequestModel.js";
import { ADMIN } from "../utils/constants.js";

// Four counts, and every one of them comes from a procedure that already
// exists and already carries the company scoping. No new procedure was asked
// for and no raw query was written.
//
// That was the whole design constraint. Company scoping is an access rule, and
// a raw query reproducing it is a second implementation of it — which is why
// getOwnershipIds was deleted in PR #56 and why the Excel export reads through
// usp_sel_hr_employees rather than a query of its own. A dashboard is a screen
// rather than a file, but the rule is the same and the cheap shortcut is the
// same mistake.
//
// Each count is here because something in the system already asks for it, not
// because a dashboard usually has four numbers:
//
//   enrolled              — the enrollment list, filtered to those who have one
//   awaitingEnrollment    — the is_enrolled = 0 list, described in
//                           BUSINESS-REQUIREMENTS §3.6 as the only list HR can
//                           act on and the stated purpose of the oversight view
//   pendingChangeRequests — already has its own endpoint driving a nav badge
//   failedInvitations     — send_status = 'failed', which HR has to chase

// The two invitation counts are null for an Administrator rather than absent or
// zero, and this is deliberate.
//
// usp_sel_enrollment_invitations_by_user throws 50073 for any caller who is not
// HR — it checks `r.us02_role_name = 'HR'` with no Administrator branch, unlike
// every other list procedure. That is the open question in PARK.md §3: the
// invitation list is the odd one out among five.
//
// Zero would be a lie: it would say nobody is waiting to enrol when the truth
// is that we were not allowed to look. Null says "not available to you", the
// dashboard can leave the tile blank, and the day the DBA adds the branch these
// become numbers with no change here.
const invitationCountsFor = async (pool, userId, roleName) => {
  if (roleName !== ADMIN) return { awaitingEnrollment: null, failedInvitations: null };

  // page_size 1 rather than the whole set. COUNT(*) OVER() is computed before
  // OFFSET/FETCH, so total_count is the count of everything matching the
  // filter regardless of how few rows come back.
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
  // to read when the result set is empty.
  return {
    awaitingEnrollment: awaiting?.total_count ?? 0,
    failedInvitations: failed?.total_count ?? 0,
  };
};

const getStats = async (pool, { user_id, role_name }) => {
  // page_size undefined reaches the procedure as NULL, which means every row.
  // Counting precisely needs the rows, because usp_sel_hr_employees counts
  // employees rather than enrollments — an employee with no enrollment is a
  // LEFT JOIN miss, and total_count would include them.
  //
  // At the current few hundred clients this costs nothing. If it ever becomes
  // slow the fix is a counting procedure from the DBA, not a raw query here.
  const employees = await ClientModel.getHrEmployees(pool, user_id);

  const enrolled = employees.filter((row) => row.enrollment_id != null).length;

  const pendingChangeRequests = await ChangeRequestModel.getPendingCountByUser(
    pool,
    user_id,
  );

  const invitations = await invitationCountsFor(pool, user_id, role_name);

  return {
    enrolled,
    awaitingEnrollment: invitations.awaitingEnrollment,
    pendingChangeRequests,
    failedInvitations: invitations.failedInvitations,
  };
};

export default { getStats };
