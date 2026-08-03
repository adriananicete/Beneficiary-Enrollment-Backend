import express from 'express';
import { login, logout } from '../controllers/authController.js';
import { authIpLimiter, strictLimiter } from '../middlewares/rateLimiter.js';

const router = express.Router();

router.post('/login', authIpLimiter, strictLimiter, login);
router.post('/logout', logout);

export default router;