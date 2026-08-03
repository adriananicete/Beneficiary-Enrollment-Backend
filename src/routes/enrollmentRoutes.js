import express from 'express';
import { getBarangays, getEmployeeClassifications, getEmployers, submitEnrollment } from '../controllers/enrollmentController.js';
import { validateEnrollment } from '../middlewares/validateEnrollment.js';
import { mediumLimiter } from '../middlewares/rateLimiter.js';

const router = express.Router();

router.get('/classifications', getEmployeeClassifications);
router.get('/employers', getEmployers);
router.get('/barangays', getBarangays);
router.post('/submit', mediumLimiter, validateEnrollment, submitEnrollment);

export default router;