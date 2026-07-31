import express from 'express';
import { getBarangays, submitEnrollment } from '../controllers/enrollmentController.js';
import { validateEnrollment } from '../middlewares/validateEnrollment.js';
import { mediumLimiter } from '../middlewares/rateLimiter.js';

const router = express.Router();

router.get('/barangays', getBarangays);
router.post('/submit', mediumLimiter, validateEnrollment, submitEnrollment);

export default router;