import express from 'express';
import { isAdmin } from '../middlewares/isAdmin.js';
import { verifyToken } from '../middlewares/verifyToken.js';
import { getEnrollment } from '../controllers/adminController.js';

const router = express.Router();

router.get('/enrollments', verifyToken, isAdmin, getEnrollment);

export default router;