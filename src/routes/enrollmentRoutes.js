import express from 'express';
import { getBarangaysByCity, getCitiesByProvince, getEmployeeClassifications, getEmployers, getInvitationByToken, getProvincesByRegion, getRegions, submitEnrollment } from '../controllers/enrollmentController.js';
import { validateEnrollment } from '../middlewares/validateEnrollment.js';
import { enrollmentTokenLimiter, mediumLimiter, referenceLimiter } from '../middlewares/rateLimiter.js';

const router = express.Router();

// Two limiters, stacked the same way the auth routes stack theirs: an IP
// ceiling against a flood, and a per-invitation ceiling against one caller
// hammering one link. Neither alone is enough — see rateLimiter.js.
router.get('/invitation', mediumLimiter, enrollmentTokenLimiter, getInvitationByToken);
// One shared budget for the six reference routes, so a caller cannot get six
// times the ceiling by spreading across them. Separate from mediumLimiter, so
// filling the dropdowns never uses up the budget for submitting.
router.get('/classifications', referenceLimiter, getEmployeeClassifications);
router.get('/employers', referenceLimiter, getEmployers);
router.get('/regions', referenceLimiter, getRegions);
router.get('/regions/:region_code/provinces', referenceLimiter, getProvincesByRegion);
router.get('/provinces/:province_code/cities', referenceLimiter, getCitiesByProvince);
router.get('/cities/:city_code/barangays', referenceLimiter, getBarangaysByCity)
router.post('/submit', mediumLimiter, enrollmentTokenLimiter, validateEnrollment, submitEnrollment);

export default router;