import express from 'express';
import { getBarangays, submitEnrollment } from '../controllers/enrollmentController.js';
import { validateEnrollment } from '../middlewares/validateEnrollment.js';

const router = express.Router();

router.get('/barangays', getBarangays);
router.post('/submit', validateEnrollment, submitEnrollment);

export default router;