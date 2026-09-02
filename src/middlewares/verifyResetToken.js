import config from "../config/env.js";
import jwt from 'jsonwebtoken';
import { AppError } from "../utils/AppError.js";

export const verifyResetToken = (req, res, next) => {
    const { reset_token } = req.cookies;
    if(!reset_token) return next(new AppError('No reset token provided', 401));

    try {
        const decoded = jwt.verify(reset_token, config.jwtSecret)
        if(decoded.purpose !== 'password_reset') return next(new AppError('Invalid token purpose', 403));

        req.resetUser = decoded;

        next()
    } catch (error) {
        console.error(error);
        return next(new AppError('Invalid or expired token', 401));
    }
}
