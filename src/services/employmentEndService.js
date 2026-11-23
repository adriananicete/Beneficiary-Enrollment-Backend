import EmploymentEndModel from "../models/employmentEndModel.js";
import { endClientSessions, endUserSessions } from "../realtime/realtime.js";

// Ending an employee's employment, DBA request 39. Decided with Adrian,
// 2026-11-23:
// - HR ends an employee of their own company, the Administrator one of any;
//   only the Administrator undoes it.
// - It is refused while a claim is open, for a deceased employee, and for the
//   caller's own employment. Once it has ended, no claims.
// - In one transaction, the procedure's own: the enrollment closes ('I'),
//   pending change requests are cancelled, and the login closes.
// - HR still sees the person, with the reason and the date.
//
// The procedure closes the login and raises the token version, so every
// session ends at verifySession on its next request. The open sockets are
// closed here. Injected so a test can see that happen without a socket server.
const defaults = { model: EmploymentEndModel, endUserSessions, endClientSessions };

// `reason` and `endDate` as parseEmploymentEnd returns them: the controller
// checks the body before a connection is taken.
export const endEmployment = async (pool, { clientId, reason, endDate, userId }, deps = {}) => {
  const { model, endUserSessions: endUser, endClientSessions: endClient } = { ...defaults, ...deps };

  const row = await model.endEmployment(pool, { clientId, reason, endDate, userId });

  // Both: the employee's sockets are in the client's room, and the account
  // closed may be an HR person's who enrolled themselves (request 31), whose
  // sockets are only in their user's room.
  if (row?.us01_user_id) endUser(row.us01_user_id);
  endClient(clientId);

  return {
    client_id: row?.client_id ?? clientId,
    enrollment_id: row?.enrollment_id ?? null,
    employment_end_reason: row?.employment_end_reason ?? reason,
    employment_end_date: row?.employment_end_date ?? endDate,
    cancelled_requests: Number(row?.cancelled_requests ?? 0),
  };
};

export const undoEmploymentEnd = async (pool, { clientId, userId }, deps = {}) => {
  const { model } = { ...defaults, ...deps };

  const row = await model.undoEmploymentEnd(pool, { clientId, userId });

  return { client_id: row?.client_id ?? clientId, enrollment_id: row?.enrollment_id ?? null };
};

export default { endEmployment, undoEmploymentEnd };
