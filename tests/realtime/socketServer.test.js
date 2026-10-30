import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import jwt from "jsonwebtoken";
import { io as connect } from "socket.io-client";

import { JWT_SECRET } from "../helpers/env.js";
import { silenceConsoleError } from "../helpers/http.js";

const { createSocketServer, SOCKET_PATH, SESSION_RECHECK_MS, TYPING_THROTTLE_MS } = await import(
  "../../src/realtime/socketServer.js"
);
const { AppError } = await import("../../src/utils/AppError.js");

// The socket server on a real HTTP server, reached by a real socket.io client.
// The database calls are fakes. What is real is the handshake: the cookie, the
// signature, the role, the session check, and the rooms a socket ends up in.
// socket.io-client is the project's first devDependency, agreed 2026-10-12 for
// exactly this, because a fake client cannot prove a refusal.

const EMPLOYEE = { user_id: 12, username: "EMP-020", role_name: "Employee", token_version: 0 };
const HR_COFORGE = { user_id: 3, username: "hr.coforge", role_name: "HR", token_version: 0 };
const HR_HCL = { user_id: 4, username: "hr.hcl", role_name: "HR", token_version: 0 };
const ADMINISTRATOR = { user_id: 1, username: "admin", role_name: "Administrator", token_version: 0 };

const sign = (claims) => jwt.sign(claims, JWT_SECRET, { expiresIn: "1h" });

// verifySession as the real one behaves, by user. A missing version is a
// reset token or a token from before revocation, and is refused.
const sessionsEnded = new Set();
const outages = new Set([99]);

const fakeVerifySession = async (pool, session) => {
  if (session.token_version === undefined || sessionsEnded.has(session.user_id))
    throw new AppError("Your session has ended. Please sign in again.", 401);

  if (outages.has(session.user_id)) throw new Error("database unreachable");

  // Every employee is client 75 except user 13, an account with no client.
  const isEmployee = session.role_name === "Employee";

  return { us01_user_id: session.user_id, client_id: isEmployee && session.user_id !== 13 ? "75" : null };
};

const MESSAGING_ACCESS = {
  12: [{ employer_id: "1", messages_enabled: true }],
  3: [{ employer_id: "1", messages_enabled: true }],
  4: [{ employer_id: "2", messages_enabled: true }],
};

// Conversation 7 is Coforge's with client 75, and open. Conversation 8 is
// read-only. Anything else is not the caller's.
const CONVERSATIONS = {
  7: { conversation_id: "7", client_id: "75", employer_id: "1", can_send: true },
  8: { conversation_id: "8", client_id: "75", employer_id: "1", can_send: false },
};

const lookups = [];

let httpServer;
let io;
let url;

before(async () => {
  httpServer = http.createServer();

  io = createSocketServer({
    httpServer,
    getPool: async () => ({}),
    verifySession: fakeVerifySession,
    getMessagingAccessByUser: async (pool, userId) =>
      MESSAGING_ACCESS[userId] ?? (userId === 13 ? [] : [{ employer_id: "1", messages_enabled: true }]),
    getConversationById: async (pool, conversationId) => {
      lookups.push(conversationId);
      return { conversation: CONVERSATIONS[conversationId] ?? null, messages: [], hasMore: false };
    },
    // Short, so the re-check and the throttle can be watched in a test. The
    // production values are pinned below.
    recheckMs: 100,
    typingThrottleMs: 100,
  });

  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${httpServer.address().port}`;
});

after(async () => {
  io.close();
});

const open = [];

const client = (token) => {
  const socket = connect(url, {
    path: SOCKET_PATH,
    transports: ["websocket"],
    extraHeaders: token ? { Cookie: `token=${token}` } : {},
    reconnection: false,
    forceNew: true,
  });

  open.push(socket);
  return socket;
};

after(() => {
  for (const socket of open) socket.close();
});

// Resolves when connected, or rejects with the refusal's reason.
const connected = (socket) =>
  new Promise((resolve, reject) => {
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", (error) => reject(error));
  });

const refusalOf = async (token) => {
  try {
    await connected(client(token));
    return "connected";
  } catch (error) {
    return error.message;
  }
};

const next = (socket, event, ms = 1000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${event} within ${ms}ms`)), ms);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

// Collects every `event` for `ms`, for asserting that something did NOT arrive.
const collect = (socket, event, ms = 300) =>
  new Promise((resolve) => {
    const seen = [];
    const listener = (payload) => seen.push(payload);
    socket.on(event, listener);
    setTimeout(() => {
      socket.off(event, listener);
      resolve(seen);
    }, ms);
  });

describe("the socket handshake", () => {
  test("no cookie is refused", async () => {
    assert.equal(await refusalOf(null), "unauthorized");
  });

  test("a token signed with another secret is refused", async () => {
    assert.equal(await refusalOf(jwt.sign(EMPLOYEE, "not-the-secret-not-the-secret-123")), "unauthorized");
  });

  // A reset token carries no version and is refused by verifySession, as on
  // every REST route.
  test("a reset token is refused", async () => {
    assert.equal(
      await refusalOf(sign({ user_id: 12, username: "EMP-020", purpose: "password_reset", role_name: "Employee" })),
      "unauthorized",
    );
  });

  test("a session the database says is over is refused", async () => {
    sessionsEnded.add(14);

    assert.equal(await refusalOf(sign({ ...EMPLOYEE, user_id: 14 })), "unauthorized");
  });

  test("the Administrator connects for audit notifications without messaging access", async () => {
    assert.equal(await refusalOf(sign(ADMINISTRATOR)), "connected");
  });

  test("an employee account with no client is refused", async () => {
    assert.equal(await refusalOf(sign({ ...EMPLOYEE, user_id: 13 })), "forbidden");
  });

  // An outage is not the caller's fault, and is not told as one.
  test("a database that cannot be reached is 'unavailable', not 'unauthorized'", async () => {
    const restore = silenceConsoleError();

    try {
      assert.equal(await refusalOf(sign({ ...EMPLOYEE, user_id: 99 })), "unavailable");
    } finally {
      restore();
    }
  });

  test("an employee and HR with live sessions connect", async () => {
    assert.equal(await refusalOf(sign(EMPLOYEE)), "connected");
    assert.equal(await refusalOf(sign(HR_COFORGE)), "connected");
  });

  test("a company with messaging disabled cannot establish a socket", async () => {
    MESSAGING_ACCESS[12] = [{ employer_id: "1", messages_enabled: false }];

    try {
      assert.equal(await refusalOf(sign(EMPLOYEE)), "forbidden");
    } finally {
      MESSAGING_ACCESS[12] = [{ employer_id: "1", messages_enabled: true }];
    }
  });
});

describe("the rooms a socket is in", () => {
  test("the Administrator hears audit notifications but not HR conversation events", async () => {
    const administrator = await connected(client(sign(ADMINISTRATOR)));
    const hr = await connected(client(sign(HR_COFORGE)));
    const auditNotification = next(administrator, "audit:new");

    io.to("audit:administrators").emit("audit:new", { audit_id: "19" });

    assert.deepEqual(await auditNotification, { audit_id: "19" });
    assert.deepEqual(await collect(hr, "audit:new", 50), []);
  });

  test("the employee hears their client room and their user room, and not a company's", async () => {
    const employee = await connected(client(sign(EMPLOYEE)));

    const heard = collect(employee, "probe");
    io.to("client:75").emit("probe", "client");
    io.to("user:12").emit("probe", "user");
    io.to("hr:1").emit("probe", "hr");

    assert.deepEqual((await heard).sort(), ["client", "user"]);
  });

  test("HR hears their own company's room, and not another company's", async () => {
    const coforge = await connected(client(sign(HR_COFORGE)));
    const hcl = await connected(client(sign(HR_HCL)));

    const heardByCoforge = collect(coforge, "probe");
    const heardByHcl = collect(hcl, "probe");
    io.to("hr:1").emit("probe", "coforge");

    assert.deepEqual(await heardByCoforge, ["coforge"]);
    assert.deepEqual(await heardByHcl, []);
  });
});

describe("the typing indicator", () => {
  test("the employee typing reaches their company's HR, and only them", async () => {
    const employee = await connected(client(sign(EMPLOYEE)));
    const coforge = await connected(client(sign(HR_COFORGE)));
    const hcl = await connected(client(sign(HR_HCL)));

    const toCoforge = next(coforge, "typing");
    const toHcl = collect(hcl, "typing");
    const echoed = collect(employee, "typing");

    employee.emit("typing", { conversation_id: "7" });

    assert.deepEqual(await toCoforge, { conversation_id: "7", sender_role: "Employee" });
    assert.deepEqual(await toHcl, []);
    assert.deepEqual(await echoed, []);
  });

  // The employee sees "HR is typing": the shared account, not a person.
  test("HR typing reaches the employee", async () => {
    const employee = await connected(client(sign(EMPLOYEE)));
    const coforge = await connected(client(sign(HR_COFORGE)));

    const toEmployee = next(employee, "typing");

    coforge.emit("typing", { conversation_id: 7 });

    assert.deepEqual(await toEmployee, { conversation_id: "7", sender_role: "HR" });
  });

  test("nothing is relayed for a read-only conversation, one that is not the caller's, or a bad id", async () => {
    const employee = await connected(client(sign(EMPLOYEE)));
    const coforge = await connected(client(sign(HR_COFORGE)));

    const before = lookups.length;
    const heard = collect(coforge, "typing", 400);

    for (const conversation_id of ["8", "999", "abc", "1".repeat(19), { a: 1 }, undefined])
      employee.emit("typing", { conversation_id });
    employee.emit("typing", "7");
    employee.emit("typing", null);

    assert.deepEqual(await heard, []);

    // Only the two real ids were looked up. Anything that cannot be an id
    // never reaches the database, where it would be a driver error in the
    // log for every keystroke.
    assert.deepEqual(lookups.slice(before).sort(), ["8", "999"]);
  });

  test("a burst of typing is relayed once, and the membership is asked once", async () => {
    const employee = await connected(client(sign(EMPLOYEE)));
    const coforge = await connected(client(sign(HR_COFORGE)));

    const before = lookups.length;
    const heard = collect(coforge, "typing", 400);

    for (let i = 0; i < 5; i++) employee.emit("typing", { conversation_id: "7" });

    assert.equal((await heard).length, 1);
    assert.equal(lookups.length - before, 1);
  });

  // Typing again after the throttle is relayed again, and the membership is
  // not asked again: it is kept for a minute, not a query per keystroke.
  test("typing after the throttle is relayed again, from the kept membership", async () => {
    const employee = await connected(client(sign(EMPLOYEE)));
    const coforge = await connected(client(sign(HR_COFORGE)));

    const before = lookups.length;
    const heard = collect(coforge, "typing", 500);

    employee.emit("typing", { conversation_id: "7" });
    await new Promise((resolve) => setTimeout(resolve, 200));
    employee.emit("typing", { conversation_id: "7" });

    assert.equal((await heard).length, 2);
    assert.equal(lookups.length - before, 1);
  });
});

describe("the session re-check", () => {
  test("a socket whose session ends is disconnected at the next re-check", async () => {
    const socket = await connected(client(sign({ ...EMPLOYEE, user_id: 15 })));

    const dropped = next(socket, "disconnect", 1000);
    sessionsEnded.add(15);

    assert.equal(await dropped, "io server disconnect");
  });

  // One outage must not sign everybody out, the same rule as verifyToken.
  test("a socket whose re-check meets an outage stays connected", async () => {
    const socket = await connected(client(sign({ ...EMPLOYEE, user_id: 16 })));

    outages.add(16);
    const drops = collect(socket, "disconnect", 400);

    assert.deepEqual(await drops, []);
    assert.equal(socket.connected, true);

    outages.delete(16);
  });

  test("a socket is disconnected after its company disables messaging", async () => {
    const socket = await connected(client(sign(EMPLOYEE)));
    const dropped = next(socket, "disconnect", 1000);
    MESSAGING_ACCESS[12] = [{ employer_id: "1", messages_enabled: false }];

    try {
      assert.equal(await dropped, "io server disconnect");
    } finally {
      MESSAGING_ACCESS[12] = [{ employer_id: "1", messages_enabled: true }];
    }
  });
});

// The production values, as literals. The tests above run with short ones.
describe("the settings", () => {
  test("the path is under /api/v1, so a proxy forwarding /api reaches it", () => {
    assert.equal(SOCKET_PATH, "/api/v1/socket.io");
  });

  test("sessions are re-checked every 5 minutes and typing is throttled to one in 1.5 seconds", () => {
    assert.equal(SESSION_RECHECK_MS, 5 * 60 * 1000);
    assert.equal(TYPING_THROTTLE_MS, 1500);
  });
});
