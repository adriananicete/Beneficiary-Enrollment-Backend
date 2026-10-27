import { devStoreOn, readStore, update } from "./devStore.js";

// The employee ID HR gives in the invitation file (docs: the Employee ID column of the
// template). dbo.enrollment_invitations has no column for it yet, so it is kept in the dev
// store, by the invitation's token, for as long as the dev store is on. The employee then
// finds it filled in on the enrollment form, and cannot change it: the server writes it over
// whatever the form sends, as it does for the class and the affiliate HR assigned.
//
// With the dev store off nothing here does anything: the template has no column for it,
// the upload ignores one, and the employee types their own ID as before.

// A token's case does not matter to the invitation lookup (the database compares without
// regard to case), so it must not matter here either.
const keyOf = (token) => String(token).toLowerCase();

const given = () => readStore().invitedEmployeeIds ?? {};

// The ID given with this invitation, or null.
export const invitedEmployeeId = (token) => {
  if (!devStoreOn() || typeof token !== "string") return null;
  return given()[keyOf(token)]?.employee_id_number ?? null;
};

// Keeps the ID with the invitation. `employerId` and `email` say whose it is, so that the same
// person can be invited again (a revoked or expired invitation) with the same ID.
export const setInvitedEmployeeId = ({ token, employeeId, employerId, email }) => {
  if (!devStoreOn()) return;

  update((store) => {
    store.invitedEmployeeIds ??= {};
    store.invitedEmployeeIds[keyOf(token)] = {
      employee_id_number: employeeId,
      employer_id: String(employerId),
      email: String(email).toLowerCase(),
    };
  });
};

// Takes the ID of an invitation back: the invitation was refused after its ID was kept, or HR
// revoked it. Its ID is then free for someone else.
export const clearInvitedEmployeeId = (token) => {
  if (!devStoreOn() || typeof token !== "string") return;
  if (!(keyOf(token) in given())) return;

  update((store) => {
    delete store.invitedEmployeeIds[keyOf(token)];
  });
};

// A person invited again gets a new token, and the old invitation's ID goes (it would hold that
// ID against everyone else for good). Called once the new invitation exists.
export const supersedeInvitedEmployeeIds = ({ token, employerId, email }) => {
  if (!devStoreOn()) return;

  const keep = keyOf(token);
  const who = String(email).toLowerCase();
  const stale = Object.entries(given())
    .filter(([key, entry]) => key !== keep && String(entry.employer_id) === String(employerId) && entry.email === who)
    .map(([key]) => key);

  if (stale.length === 0) return;

  update((store) => {
    for (const key of stale) delete store.invitedEmployeeIds[key];
  });
};

// True when an invitation of another person already carries this ID, in any company: an ID
// becomes a login name, and login names are shared by every company. The same email is not
// another person.
export const employeeIdGivenToSomeoneElse = ({ employeeId, email }) => {
  if (!devStoreOn()) return false;

  const wanted = String(employeeId).toLowerCase();
  const who = String(email).toLowerCase();

  return Object.values(given()).some((entry) => entry.employee_id_number.toLowerCase() === wanted && entry.email !== who);
};

// In front of the enrollment submit: if HR gave this invitation an employee ID, it is the
// employee ID of the enrollment, whatever the form says. Does nothing otherwise.
//
// The token is trimmed here, first. The enrollment's own checks trim it (trimStrings) before
// they read it, so an invitation must be found by the very token they will use: a space or a
// line break around it must not be a way past HR's ID. A token that is no invitation's finds nothing.
export const applyInvitedEmployeeId = (req, res, next) => {
  if (req.body && typeof req.body === "object" && typeof req.body.token === "string") req.body.token = req.body.token.trim();

  const id = invitedEmployeeId(req.body?.token);
  if (id && req.body && typeof req.body === "object") req.body.employee_id_number = id;

  next();
};

export default {
  invitedEmployeeId,
  setInvitedEmployeeId,
  clearInvitedEmployeeId,
  supersedeInvitedEmployeeIds,
  employeeIdGivenToSomeoneElse,
  applyInvitedEmployeeId,
};
