import express from 'express';
import { changePassword, login, logout } from '../controllers/authController.js';
import { authIpLimiter, strictLimiter } from '../middlewares/rateLimiter.js';
import { verifyResetToken } from '../middlewares/verifyResetToken.js';

const router = express.Router();

router.post('/login', authIpLimiter, strictLimiter, login);
// Same chain as the employee side: the reset token authenticates this, not a
// session, and the username is read from the token rather than the body.
router.post('/change-password', authIpLimiter, strictLimiter, verifyResetToken, changePassword);
router.post('/logout', logout);

export default router;