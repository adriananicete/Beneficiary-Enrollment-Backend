// Starts a server on `port`, or, while developing, on the next free port when that one is
// taken (EADDRINUSE). A second `npm run dev` then comes up beside the first instead of
// crashing, and the caller is told which port it got. Ported from the teammates' f78f721.
//
// With `fallback` false a taken port is the error it always was: a server that quietly moves
// would leave the proxy in front of it pointing at the old one, or at nothing. Any other error
// is passed on at once. After `tries` ports, the last error is.
//
// Resolves with the port that is listening.
export const listenOnFreePort = (server, { port, host, fallback = true, tries = 10 }) =>
  new Promise((resolve, reject) => {
    const attempt = (candidate, left) => {
      const onListening = () => {
        server.removeListener("error", onError);
        resolve(server.address()?.port ?? candidate);
      };

      const onError = (error) => {
        server.removeListener("listening", onListening);

        if (error.code === "EADDRINUSE" && fallback && left > 1) return attempt(candidate + 1, left - 1);

        reject(error);
      };

      server.once("listening", onListening);
      server.once("error", onError);
      server.listen(candidate, host);
    };

    attempt(Number(port), tries);
  });

// Whether a taken port may move to the next one: only when `npm run dev` started the server,
// which npm says in npm_lifecycle_event. Not by NODE_ENV, as the teammates had it. UAT runs as
// development, but its service starts `node --env-file=.env server.js` directly (NSSM, read in
// their deploy script), and an old instance still holding the port during a restart would send
// the new one to 7001 while the proxy kept serving the old. Production and UAT stay strict.
export const startedByNpmDev = (env = process.env) => env.npm_lifecycle_event === "dev";

export default { listenOnFreePort, startedByNpmDev };
