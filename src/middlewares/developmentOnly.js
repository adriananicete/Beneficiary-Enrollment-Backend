// A route that exists only where NODE_ENV is not production: the development
// wipe (DBA request 26). In production it leaves the router without a word,
// so the request ends in the same 404 as a path that was never declared. It
// runs before verifyToken on purpose: a 401 would tell a caller the route is
// there.
//
// Takes the environment rather than reading config, so both sides can be
// tested in one process.
export const developmentOnly = (nodeEnv) => (req, res, next) =>
  nodeEnv === "production" ? next("router") : next();

export default { developmentOnly };
