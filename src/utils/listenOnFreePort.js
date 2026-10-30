// Starts a server on `port`, or, while developing, on the next free port when that one is
// taken (EADDRINUSE). A second `npm run dev` then comes up beside the first instead of
// crashing, and the caller is told which port it got.
//
// With `fallback` false, which is how production runs it, a taken port is the error it
// always was: a server that quietly moves would leave the proxy in front of it pointing at
// nothing. Any other error is passed on at once. After `tries` ports, the last error is.
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

export default { listenOnFreePort };
