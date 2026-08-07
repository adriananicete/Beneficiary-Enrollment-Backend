import { sqlErrorMap } from "../utils/sqlErrorMap.js";

export const errorHandler = (err, req, res, next) => {
  let message;
  let statusCode;

  const number = err.number ?? err.originalError?.number;
  const mapped = sqlErrorMap[number];

  console.error("ErrorHandler:", err);
  if (err.statusCode) {
    statusCode = err.statusCode;
    message = err.message;
  } else if (mapped) {
    statusCode = mapped.statusCode;
    message = mapped.message;
  } else {
    statusCode = 500;
    message = "Server Error";
  }

  res.status(statusCode).json({
    success: false,
    message: message,
  });
};
