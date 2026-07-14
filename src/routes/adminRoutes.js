import express from 'express';
import { allowedRoles } from '../middlewares/allowedRoles.js';
import { verifyToken } from '../middlewares/verifyToken.js';
import { editEnrollment, exportEnrollments, getDashboardStats, getEnrollment, getEnrollmentDetails } from '../controllers/adminController.js';

const router = express.Router();

router.get('/enrollments', verifyToken, allowedRoles('admin', 'superadmin'), getEnrollment);
router.get('/enrollments/export', verifyToken, allowedRoles('admin', 'superadmin'), exportEnrollments);
router.get('/dashboard/stats', verifyToken, allowedRoles('admin', 'superadmin'), getDashboardStats);
router.get('/enrollments/:id', verifyToken, allowedRoles('admin', 'superadmin'), getEnrollmentDetails);
router.put('/enrollments/:id', verifyToken, allowedRoles('admin', 'superadmin'), editEnrollment);


export default router;