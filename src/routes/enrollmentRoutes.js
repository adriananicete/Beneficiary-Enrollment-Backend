import express from 'express';
import { getBarangaysByCity, getCitiesByProvince, getEmployeeClassifications, getEmployers, getInvitationByToken, getProvincesByRegion, getRegions, submitEnrollment } from '../controllers/enrollmentController.js';
import { validateEnrollment } from '../middlewares/validateEnrollment.js';
import { mediumLimiter } from '../middlewares/rateLimiter.js';

const router = express.Router();

router.get('/invitation', mediumLimiter, getInvitationByToken);
router.get('/classifications', getEmployeeClassifications);
router.get('/employers', getEmployers);
router.get('/regions', getRegions);
router.get('/regions/:region_code/provinces', getProvincesByRegion);
router.get('/provinces/:province_code/cities', getCitiesByProvince);
router.get('/cities/:city_code/barangays', getBarangaysByCity)
router.post('/submit', mediumLimiter, validateEnrollment, submitEnrollment);

export default router;