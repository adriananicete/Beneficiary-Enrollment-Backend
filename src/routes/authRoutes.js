import express from 'express';
import { changePassword, getMe, login, logout } from '../controllers/authController.js';
import { authIpLimiter, sessionLimiter, strictLimiter } from '../middlewares/rateLimiter.js';
import { verifyResetToken } from '../middlewares/verifyResetToken.js';
import { verifyToken } from '../middlewares/verifyToken.js';

const router = express.Router();

router.post('/login', authIpLimiter, strictLimiter, login);
// Same chain as the employee side: the reset token authenticates this, not a
// session, and the username is read from the token rather than the body.
router.post('/change-password', authIpLimiter, strictLimiter, verifyResetToken, changePassword);
router.post('/logout', logout);
// All three roles, so no allowedRoles: the role is what it reports. The limiter
// sits after verifyToken because it counts per user, and req.user is set there.
router.get('/me', verifyToken, sessionLimiter, getMe);

export default router;