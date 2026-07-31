export const errorHandler = (err, req, res, next) => {
  let message;
  let statusCode;

  console.error("ErrorHandler:", err);
  if (err.statusCode) {
    statusCode = err.statusCode;
    message = err.message;
  } else {
    statusCode = 500;
    message = "Server Error";
  }

  res.status(statusCode).json({
    success: false,
    message: message,
  });
};
