import { Server } from "socket.io";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import config from "../config/env.js";
import { ADMIN, EMPLOYEE } from "../utils/constants.js";
import EmployerModel from "../models/employerModel.js";
import MessageModel from "../models/messageModel.js";
import { isNumericId } from "../middlewares/validateIdParam.js";
import { rooms } from "./realtime.js";

// The socket half of messaging, branch 9 of md/CLAIMS-AND-MESSAGING-DECISIONS.md.
// Decided with Adrian, 2026-10-12.
//
// It only announces. A message is sent over REST, saved, and then announced
// here, so nothing a socket does can write to the database. The one event a
// client sends, `typing`, is relayed and never stored.
//
// Built from its dependencies so a test can run it on a real HTTP server with
// a real client and fake database calls. server.js passes the real ones.

// Under /api, so a proxy that forwards /api to this server forwards this too.
export const SOCKET_PATH = "/api/v1/socket.io";

// A socket can stay open for hours, and the handshake checked the session only
// once. Every socket's session is checked again on this interval, so an
// account closed or a session ended some other way loses its socket within
// five minutes. Logout, password changes, reissued credentials and a closing
// claim cut it at once, through realtime.js.
export const SESSION_RECHECK_MS = 5 * 60 * 1000;

// A screen sends `typing` about every two seconds while keys are pressed.
// Anything faster than this from one socket for one conversation is dropped.
export const TYPING_THROTTLE_MS = 1500;

// Whether a socket's user is in a conversation is asked of the database once
// and kept this long, so typing does not cost a query per keystroke.
export const MEMBERSHIP_TTL_MS = 60 * 1000;

// What a refused handshake tells the client, in err.message.
const refusal = (reason) => Object.assign(new Error(reason), { data: { reason } });

export const createSocketServer = ({
  httpServer,
  getPool,
  verifySession,
  getMessagingAccessByUser = EmployerModel.getMessagingAccessByUser,
  getConversationById = MessageModel.getConversationById,
  recheckMs = SESSION_RECHECK_MS,
  typingThrottleMs = TYPING_THROTTLE_MS,
}) => {
  const io = new Server(httpServer, {
    path: SOCKET_PATH,
    cors: { origin: config.corsOrigin, credentials: true },
    serveClient: false,
  });

  // The session cookie, read the way Express reads it for every request.
  io.engine.use(cookieParser());

  // The same checks as verifyToken: a signed token, then the database's view
  // of the account and its token version. Anything that fails is refused.
  io.use(async (socket, next) => {
    const token = socket.request.cookies?.token;

    if (!token) return next(refusal("unauthorized"));

    let session;

    try {
      session = jwt.verify(token, config.jwtSecret);
    } catch {
      return next(refusal("unauthorized"));
    }

    // Messaging is the employee's and HR's. The Administrator has no access
    // in v1 (decided 2026-10-12). ADMIN is 'HR'.
    if (session.role_name !== EMPLOYEE && session.role_name !== ADMIN)
      return next(refusal("forbidden"));

    try {
      const pool = await getPool();
      const user = await verifySession(pool, session);
      const access = await getMessagingAccessByUser(pool, session.user_id);
      const enabled = access.filter((company) =>
        company.messages_enabled === true ||
        company.messages_enabled === 1 ||
        company.messages_enabled === "1",
      );
      if (enabled.length === 0) return next(refusal("forbidden"));

      const joined =
        session.role_name === EMPLOYEE
          ? user.client_id
            ? [rooms.client(user.client_id)]
            : []
          : enabled.map((company) => rooms.hr(company.employer_id));
      if (joined.length === 0) return next(refusal("forbidden"));

      socket.data.session = session;
      socket.data.rooms = [rooms.user(session.user_id), ...joined];

      next();
    } catch (error) {
      // A 401 is a session that is over. Anything else, such as the
      // database being down, is not the caller's fault and is logged.
      if (error.statusCode === 401) return next(refusal("unauthorized"));

      console.error("Socket handshake failed:", error);
      next(refusal("unavailable"));
    }
  });

  io.on("connection", (socket) => {
    const { session } = socket.data;
    const isEmployee = session.role_name === EMPLOYEE;

    socket.join(socket.data.rooms);

    const recheck = setInterval(async () => {
      try {
        const pool = await getPool();
        await verifySession(pool, session);
        const access = await getMessagingAccessByUser(pool, session.user_id);
        const enabled = access.filter((company) =>
          company.messages_enabled === true ||
          company.messages_enabled === 1 ||
          company.messages_enabled === "1",
        );
        if (enabled.length === 0) {
          socket.disconnect(true);
          return;
        }

        const userRoom = rooms.user(session.user_id);
        const joined =
          session.role_name === EMPLOYEE
            ? [socket.data.rooms.find((room) => room.startsWith("client:"))].filter(Boolean)
            : enabled.map((company) => rooms.hr(company.employer_id));
        const nextRooms = [userRoom, ...joined];
        for (const room of socket.data.rooms)
          if (!nextRooms.includes(room)) socket.leave(room);
        for (const room of nextRooms)
          if (!socket.data.rooms.includes(room)) socket.join(room);
        socket.data.rooms = nextRooms;
      } catch (error) {
        // An outage is not a reason to drop everybody. Only an ended
        // session is.
        if (error.statusCode === 401) socket.disconnect(true);
      }
    }, recheckMs);

    // Never what keeps the process alive.
    recheck.unref?.();

    const lastTyping = new Map();
    const membership = new Map();

    // The conversation as this socket's user may see it, or null. Kept for
    // MEMBERSHIP_TTL_MS.
    const conversationFor = async (conversationId) => {
      const known = membership.get(conversationId);

      if (known && Date.now() - known.at < MEMBERSHIP_TTL_MS) return known.conversation;

      const pool = await getPool();
      const { conversation } = await getConversationById(pool, conversationId, session.user_id, { limit: 1 });

      membership.set(conversationId, { at: Date.now(), conversation });

      return conversation;
    };

    socket.on("typing", async (payload) => {
      try {
        const raw = payload?.conversation_id;

        if (!(typeof raw === "string" || typeof raw === "number") || !isNumericId(raw)) return;

        const conversationId = String(raw);
        const now = Date.now();

        if (now - (lastTyping.get(conversationId) ?? 0) < typingThrottleMs) return;
        lastTyping.set(conversationId, now);

        const conversation = await conversationFor(conversationId);

        // Not theirs, or read-only: nothing to say.
        if (!conversation || !conversation.can_send) return;
        const access = await getMessagingAccessByUser(await getPool(), session.user_id);
        if (
          !access.some(
            (company) =>
              String(company.employer_id) === String(conversation.employer_id) &&
              (company.messages_enabled === true ||
                company.messages_enabled === 1 ||
                company.messages_enabled === "1"),
          )
        )
          return;

        // To the other side only. The employee sees "HR is typing", because
        // HR is one shared account.
        const otherSide = isEmployee
          ? rooms.hr(conversation.employer_id)
          : rooms.client(conversation.client_id);

        socket.to(otherSide).emit("typing", {
          conversation_id: conversationId,
          sender_role: isEmployee ? "Employee" : "HR",
        });
      } catch (error) {
        console.error("Typing relay failed:", error);
      }
    });

    socket.on("disconnect", () => {
      clearInterval(recheck);
      lastTyping.clear();
      membership.clear();
    });
  });

  return io;
};

export default { createSocketServer, SOCKET_PATH };
