import express from 'express';
import { isAdmin } from '../middlewares/isAdmin.js';
import { verifyToken } from '../middlewares/verifyToken.js';
import { editEnrollment, getEnrollment, getEnrollmentDetails } from '../controllers/adminController.js';

const router = express.Router();

router.get('/enrollments', verifyToken, isAdmin, getEnrollment);
router.get('/enrollments/:id', verifyToken, isAdmin, getEnrollmentDetails);
router.put('/enrollments/:id', verifyToken, isAdmin, editEnrollment);

export default router;