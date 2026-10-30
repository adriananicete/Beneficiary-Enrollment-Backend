// The one place the rest of the backend tells connected screens that
// something happened. Branch 9 of md/CLAIMS-AND-MESSAGING-DECISIONS.md.
//
// It holds the socket.io server once server.js has attached one, and does
// nothing until then. The tests and every REST call work the same with no
// socket server at all. Nothing here can fail the caller: the socket only
// announces, REST is the source of truth, and a failed announcement is a
// screen that updates on its next poll, logged.
//
// Nothing here imports socket.io. The services that call it stay free of it.

let io = null;

export const setRealtimeServer = (server) => {
  io = server;
};

export const realtimeIsOn = () => io !== null;

// Room names, in one place, because the socket server joins them and this
// module emits to them, and a typo on either side is silence.
export const rooms = {
  client: (clientId) => `client:${clientId}`,
  hr: (employerId) => `hr:${employerId}`,
  user: (userId) => `user:${userId}`,
  auditAdministrators: () => "audit:administrators",
};

const safely = (what, act) => {
  if (!io) return;

  try {
    act(io);
  } catch (error) {
    console.error(`Realtime ${what} failed:`, error);
  }
};

// Both sides of a conversation: the employee's sockets, and those of every HR
// user of the company. The sender's other tabs hear it too; the frontend
// knows a message by its id.
export const emitToConversation = ({ clientId, employerId }, event, payload) =>
  safely(event, (server) =>
    server.to([rooms.client(clientId), rooms.hr(employerId)]).emit(event, payload),
  );

export const emitAuditLogged = (auditId) =>
  safely("audit notification", (server) =>
    server.to(rooms.auditAdministrators()).emit("audit:new", { audit_id: auditId }),
  );

// Every socket of one user: logout, a password change, reissued credentials.
// Their tokens already stop working at verifySession; this closes the sockets
// opened with them rather than waiting for the next re-check.
export const endUserSessions = (userId) =>
  safely("disconnect", (server) => server.in(rooms.user(userId)).disconnectSockets(true));

// Every socket of one employee, when their account is closed by a claim. The
// procedure that closes it reports the client, not the user.
export const endClientSessions = (clientId) =>
  safely("disconnect", (server) => server.in(rooms.client(clientId)).disconnectSockets(true));

export default {
  setRealtimeServer,
  realtimeIsOn,
  rooms,
  emitToConversation,
  emitAuditLogged,
  endUserSessions,
  endClientSessions,
};
