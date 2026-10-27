import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import http from "node:http";
import net from "node:net";

import { listenOnFreePort } from "../../src/utils/listenOnFreePort.js";

// A port the operating system says is free right now.
const freePort = () =>
  new Promise((resolve) => {
    const probe = net.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

// A listener that holds a port until closed.
const occupy = (port) =>
  new Promise((resolve, reject) => {
    const holder = net.createServer();
    holder.once("error", reject);
    holder.listen(port, "127.0.0.1", () => resolve(holder));
  });

const closeAll = (...servers) => Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));

// A server whose listen() answers from a script, to reach errors that are hard to cause for real.
const scripted = (errors) => {
  const server = new EventEmitter();
  const tried = [];
  server.address = () => null;
  server.listen = (port) => {
    tried.push(port);
    const error = errors[port];
    setImmediate(() => (error ? server.emit("error", Object.assign(new Error(error), { code: error })) : server.emit("listening")));
  };
  server.tried = tried;
  return server;
};

describe("listenOnFreePort", () => {
  test("uses the port asked for when it is free", async () => {
    const port = await freePort();
    const server = http.createServer();

    assert.equal(await listenOnFreePort(server, { port, host: "127.0.0.1" }), port);
    await closeAll(server);
  });

  test("uses the next port when that one is taken", async () => {
    const port = await freePort();
    const holder = await occupy(port);
    const server = http.createServer();

    const got = await listenOnFreePort(server, { port, host: "127.0.0.1" });

    assert.equal(got, port + 1);
    assert.equal(server.address().port, port + 1, "and it really is listening there");
    await closeAll(server, holder);
  });

  test("skips every port that is taken in a row", async () => {
    const port = await freePort();
    const holders = [await occupy(port), await occupy(port + 1), await occupy(port + 2)];
    const server = http.createServer();

    assert.equal(await listenOnFreePort(server, { port, host: "127.0.0.1" }), port + 3);
    await closeAll(server, ...holders);
  });

  test("a taken port stays an error when falling back is off (production)", async () => {
    const port = await freePort();
    const holder = await occupy(port);
    const server = http.createServer();

    await assert.rejects(listenOnFreePort(server, { port, host: "127.0.0.1", fallback: false }), { code: "EADDRINUSE" });
    await closeAll(holder);
  });

  test("gives up after the number of tries it was given, with the last error", async () => {
    const server = scripted({ 7000: "EADDRINUSE", 7001: "EADDRINUSE", 7002: "EADDRINUSE" });

    await assert.rejects(listenOnFreePort(server, { port: 7000, host: "h", tries: 3 }), { code: "EADDRINUSE" });
    assert.deepEqual(server.tried, [7000, 7001, 7002]);
  });

  test("any other error is passed on at once, without trying another port", async () => {
    const server = scripted({ 7000: "EACCES" });

    await assert.rejects(listenOnFreePort(server, { port: 7000, host: "h" }), { code: "EACCES" });
    assert.deepEqual(server.tried, [7000]);
  });

  test("a port given as text, as it is in the environment, is still counted", async () => {
    const server = scripted({ 7000: "EADDRINUSE" });

    assert.equal(await listenOnFreePort(server, { port: "7000", host: "h" }), 7001);
    assert.deepEqual(server.tried, [7000, 7001]);
  });

  test("leaves no listeners behind on the server", async () => {
    const server = scripted({ 7000: "EADDRINUSE" });
    await listenOnFreePort(server, { port: 7000, host: "h" });

    assert.equal(server.listenerCount("error"), 0);
    assert.equal(server.listenerCount("listening"), 0);
  });
});
