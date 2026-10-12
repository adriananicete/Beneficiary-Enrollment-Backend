// A socket.io server that remembers what it was told to do, for the code that
// announces through src/realtime/realtime.js. The socket server itself is
// tested against a real one, in tests/realtime/socketServer.test.js.
export const fakeIo = () => {
  const events = [];

  const io = {
    to(rooms) {
      return {
        emit: (event, payload) => events.push({ kind: "emit", rooms: [].concat(rooms), event, payload }),
      };
    },
    in(room) {
      return {
        disconnectSockets: (close) => events.push({ kind: "disconnect", room, close }),
      };
    },
  };

  return { io, events };
};

export default { fakeIo };
