import config from "../config/env.js";
import jwt from 'jsonwebtoken';

export const verifyResetToken = (req, res, next) => {
    const { reset_token } = req.cookies;
    if(!reset_token) return res.status(401).json({ message: 'No reset token provided'});

    try {
        const decoded = jwt.verify(reset_token, config.jwtSecret)
        if(decoded.purpose !== 'password_reset') return res.status(403).json({message: 'Invalid token purpose'});

        req.resetUser = decoded;

        next()
    } catch (error) {
        console.error(error);
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}