import express from 'express';
import { getMyEnrollment, login, logout, changePassword } from '../controllers/employeeController.js';
import { verifyToken } from '../middlewares/verifyToken.js';
import { allowedRoles } from '../middlewares/allowedRoles.js';
import { EMPLOYEE } from '../utils/constants.js';
import { verifyResetToken } from '../middlewares/verifyResetToken.js';
import { authIpLimiter, strictLimiter } from '../middlewares/rateLimiter.js';
import { getMyAgreements } from '../controllers/enrollmentController.js';

const router = express.Router();

router.post('/login', authIpLimiter, strictLimiter, login);
router.post('/logout', logout);
router.post('/change-password', authIpLimiter, strictLimiter, verifyResetToken, changePassword);
router.get('/enrollment', verifyToken, allowedRoles(EMPLOYEE), getMyEnrollment);
router.get('/agreements', verifyToken, allowedRoles(EMPLOYEE), getMyAgreements);

export default router;