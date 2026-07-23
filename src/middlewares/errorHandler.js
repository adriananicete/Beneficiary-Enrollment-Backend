export const errorHandler = (err, req, res, next) => {
    console.error('ErrorHandler:', err);
    const message = err.originalError?.message || err.message;
    const statusCode = err.statusCode || 500;

    res.status(statusCode).json({
        success: false,
        message: message
    });
}