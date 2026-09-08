import express from 'express';
import { getBarangaysByCity, getCitiesByProvince, getEmployeeClassifications, getEmployers, getInvitationByToken, getProvincesByRegion, getRegions, submitEnrollment } from '../controllers/enrollmentController.js';
import { validateEnrollment } from '../middlewares/validateEnrollment.js';
import { enrollmentTokenLimiter, mediumLimiter } from '../middlewares/rateLimiter.js';

const router = express.Router();

// Two limiters, stacked the same way the auth routes stack theirs: an IP
// ceiling against a flood, and a per-invitation ceiling against one caller
// hammering one link. Neither alone is enough — see rateLimiter.js.
router.get('/invitation', mediumLimiter, enrollmentTokenLimiter, getInvitationByToken);
router.get('/classifications', getEmployeeClassifications);
router.get('/employers', getEmployers);
router.get('/regions', getRegions);
router.get('/regions/:region_code/provinces', getProvincesByRegion);
router.get('/provinces/:province_code/cities', getCitiesByProvince);
router.get('/cities/:city_code/barangays', getBarangaysByCity)
router.post('/submit', mediumLimiter, enrollmentTokenLimiter, validateEnrollment, submitEnrollment);

export default router;