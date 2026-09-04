// Fakes for the three arguments Express hands a middleware.
//
// Every middleware in scope is a plain synchronous (req, res, next) that reports
// failure by calling next(new AppError(message, statusCode)) and never throws
// and never sends. So a test only has to look at what next was given — except
// for errorHandler, which is the one that writes a response.

export const makeReq = (overrides = {}) => ({
  body: {},
  params: {},
  query: {},
  cookies: {},
  ...overrides,
});

// Records what it was called with, so a test can assert the status code and not
// merely that something was refused. `next()` with no argument is the pass
// signal and is deliberately distinguishable from `next(undefined)` never
// happening at all.
export const makeNext = () => {
  const calls = [];

  const next = (arg) => {
    calls.push(arg);
  };

  next.calls = calls;
  next.passed = () => calls.length === 1 && calls[0] === undefined;

  // { statusCode, message } for a refusal, or null if nothing was refused.
  next.refusal = () => {
    const error = calls.find((call) => call !== undefined);
    if (!error) return null;

    return { statusCode: error.statusCode, message: error.message };
  };

  return next;
};

export const makeRes = () => {
  const res = { statusCode: null, body: null };

  res.status = (code) => {
    res.statusCode = code;
    return res;
  };

  res.json = (payload) => {
    res.body = payload;
    return res;
  };

  return res;
};

// errorHandler console.errors on every call, which would bury the test output.
// Returns a restore function.
export const silenceConsoleError = () => {
  const original = console.error;
  console.error = () => {};

  return () => {
    console.error = original;
  };
};
