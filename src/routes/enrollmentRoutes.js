import express from 'express';
import { submitEnrollment } from '../controllers/enrollmentController.js';
import { validateEnrollment } from '../middlewares/validateEnrollment.js';

const router = express.Router();

router.post('/submit', validateEnrollment, submitEnrollment);

export default router;