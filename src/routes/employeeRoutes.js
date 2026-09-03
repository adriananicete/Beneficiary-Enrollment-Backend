import express from 'express';
import { getMyEnrollment, login, logout, changePassword } from '../controllers/employeeController.js';
import { verifyToken } from '../middlewares/verifyToken.js';
import { allowedRoles } from '../middlewares/allowedRoles.js';
import { EMPLOYEE } from '../utils/constants.js';
import { verifyResetToken } from '../middlewares/verifyResetToken.js';
import { authIpLimiter, strictLimiter } from '../middlewares/rateLimiter.js';
import { getMyAgreements } from '../controllers/enrollmentController.js';
import { validateEnrollmentUpdate } from '../middlewares/validateEnrollmentUpdate.js';
import { cancelMyChangeRequest, getMyChangeRequests, submitChangeRequest } from '../controllers/changeRequestController.js';

const router = express.Router();

router.post('/login', authIpLimiter, strictLimiter, login);
router.post('/logout', logout);
router.post('/change-password', authIpLimiter, strictLimiter, verifyResetToken, changePassword);
router.get('/enrollment', verifyToken, allowedRoles(EMPLOYEE), getMyEnrollment);
router.get('/agreements', verifyToken, allowedRoles(EMPLOYEE), getMyAgreements);
router.post('/change-requests', verifyToken, allowedRoles(EMPLOYEE), validateEnrollmentUpdate, submitChangeRequest);
router.get('/change-requests', verifyToken, allowedRoles(EMPLOYEE), getMyChangeRequests);
router.patch('/change-requests/:request_id/cancel', verifyToken, allowedRoles(EMPLOYEE), cancelMyChangeRequest);

export default router;