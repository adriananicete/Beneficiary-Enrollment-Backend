import express from 'express';
import { allowedRoles } from '../middlewares/allowedRoles.js';
import { verifyToken } from '../middlewares/verifyToken.js';
import { editEnrollment, exportEnrollments, getDashboardStats, getEnrollment, getEnrollmentDetails } from '../controllers/adminController.js';
import { ADMIN, SUPER_ADMIN } from '../utils/constants.js';
import { verifyClientAccess } from '../middlewares/verifyClientAccess.js';
import { validateEnrollmentUpdate } from '../middlewares/validateEnrollmentUpdate.js';

const router = express.Router();

router.get('/enrollments', verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), getEnrollment);
router.get('/enrollments/export', verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), exportEnrollments);
router.get('/dashboard/stats', verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), getDashboardStats);
router.get('/enrollments/:client_id', verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), verifyClientAccess, getEnrollmentDetails);
router.put('/enrollments/:client_id', verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), verifyClientAccess, validateEnrollmentUpdate, editEnrollment);


export default router;