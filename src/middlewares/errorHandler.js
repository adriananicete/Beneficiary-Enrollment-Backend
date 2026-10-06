import { sqlErrorMap } from "../utils/sqlErrorMap.js";
import { AppError } from "../utils/AppError.js";

// Errors a library raises before our code runs, carrying an HTTP status of
// their own: express.json() (http-errors, with a `type`), and the Express
// router when a URL param's percent-encoding does not decode. Their messages
// are written for developers, and some quote the request. A malformed JSON
// body came back with a piece of itself in the message. So the status is kept
// and the message is always ours. Found 2026-10-06, preparing for a pentest.
//
// express.json() sets both `status` and `statusCode`. The router sets only
// `status`, which is why a badly encoded URL used to answer 500.
const LIBRARY_MESSAGES = {
  "entity.parse.failed": "The request body is not valid JSON.",
  "entity.too.large": "The request body is too large.",
  "charset.unsupported": "The request body's encoding is not supported.",
  "encoding.unsupported": "The request body's encoding is not supported.",
};

const LIBRARY_FALLBACK = "The request could not be read.";

// A 4xx from a library, or null. A 5xx from one is still a plain 500.
const libraryStatus = (err) => {
  const status = err?.statusCode ?? err?.status;

  return Number.isInteger(status) && status >= 400 && status < 500 ? status : null;
};

export const errorHandler = (err, req, res, next) => {
  let message;
  let statusCode;

  const number = err?.number ?? err?.originalError?.number;
  const mapped = sqlErrorMap[number];

  console.error("ErrorHandler:", err);

  // Only our own AppError speaks for itself. It used to be anything with a
  // statusCode, which is what let a library's message through.
  if (err instanceof AppError) {
    statusCode = err.statusCode;
    message = err.message;
  } else if (mapped) {
    statusCode = mapped.statusCode;
    message = mapped.message;
  } else if (libraryStatus(err)) {
    statusCode = libraryStatus(err);
    message = LIBRARY_MESSAGES[err.type] ?? LIBRARY_FALLBACK;
  } else {
    statusCode = 500;
    message = "Server Error";
  }

  res.status(statusCode).json({
    success: false,
    message: message,
  });
};
