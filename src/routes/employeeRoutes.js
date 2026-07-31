import express from 'express';
import { getMyEnrollment, editMyEnrollment, login, logout, changePassword } from '../controllers/employeeController.js';
import { verifyToken } from '../middlewares/verifyToken.js';
import { allowedRoles } from '../middlewares/allowedRoles.js';
import { EMPLOYEE } from '../utils/constants.js';
import { verifyResetToken } from '../middlewares/verifyResetToken.js';

const router = express.Router();

router.post('/login', login);
router.post('/logout', logout);
router.post('/change-password', verifyResetToken, changePassword);
router.get('/enrollment', verifyToken, allowedRoles(EMPLOYEE), getMyEnrollment);
router.put('/enrollment', verifyToken, allowedRoles(EMPLOYEE), editMyEnrollment);

export default router;