import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  emitToConversation,
  endClientSessions,
  endUserSessions,
  realtimeIsOn,
  rooms,
  setRealtimeServer,
} from "../../src/realtime/realtime.js";
import { fakeIo } from "../helpers/fakeIo.js";
import { silenceConsoleError } from "../helpers/http.js";

// The announcer the rest of the backend calls. It must reach the right rooms,
// and it must never fail its caller: REST is the source of truth.

afterEach(() => setRealtimeServer(null));

describe("realtime announcements", () => {
  test("a conversation event goes to the employee's room and the company's HR room", () => {
    const { io, events } = fakeIo();
    setRealtimeServer(io);

    emitToConversation({ clientId: "75", employerId: "1" }, "message:new", { message_id: "120" });

    assert.deepEqual(events, [
      { kind: "emit", rooms: ["client:75", "hr:1"], event: "message:new", payload: { message_id: "120" } },
    ]);
  });

  test("ending a user's sessions disconnects every socket in their user room, closing it", () => {
    const { io, events } = fakeIo();
    setRealtimeServer(io);

    endUserSessions(12);

    assert.deepEqual(events, [{ kind: "disconnect", room: "user:12", close: true }]);
  });

  test("closing an employee's account disconnects their client room", () => {
    const { io, events } = fakeIo();
    setRealtimeServer(io);

    endClientSessions("75");

    assert.deepEqual(events, [{ kind: "disconnect", room: "client:75", close: true }]);
  });

  // The tests, and any process that never attached a socket server.
  test("with no socket server, every call does nothing and says it is off", () => {
    assert.equal(realtimeIsOn(), false);

    emitToConversation({ clientId: "75", employerId: "1" }, "message:new", {});
    endUserSessions(12);
    endClientSessions("75");
  });

  test("a socket server that throws never fails the caller", () => {
    const restore = silenceConsoleError();

    try {
      setRealtimeServer({
        to: () => {
          throw new Error("adapter down");
        },
        in: () => {
          throw new Error("adapter down");
        },
      });

      emitToConversation({ clientId: "75", employerId: "1" }, "message:new", {});
      endUserSessions(12);
    } finally {
      restore();
    }
  });

  // The socket server joins these and this module emits to them. A typo on
  // either side is silence, so the names are pinned as literals.
  test("room names", () => {
    assert.equal(rooms.client(75), "client:75");
    assert.equal(rooms.hr(1), "hr:1");
    assert.equal(rooms.user(12), "user:12");
  });
});
