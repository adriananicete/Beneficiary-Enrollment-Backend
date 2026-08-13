import express from 'express';
import { allowedRoles } from '../middlewares/allowedRoles.js';
import { verifyToken } from '../middlewares/verifyToken.js';
import { editEnrollment, exportEnrollments, getDashboardStats, getEnrollment, getEnrollmentAgreements, getEnrollmentDetails } from '../controllers/adminController.js';
import { ADMIN, SUPER_ADMIN } from '../utils/constants.js';
import { verifyClientAccess } from '../middlewares/verifyClientAccess.js';
import { validateEnrollmentUpdate } from '../middlewares/validateEnrollmentUpdate.js';
import { getInvitations, revokeInvitation, sendInvitations } from '../controllers/invitationController.js';
import { validateInvitations } from '../middlewares/validateInvitations.js';

const router = express.Router();

router.post('/invitations', verifyToken, allowedRoles(ADMIN), validateInvitations, sendInvitations)
router.get('/invitations', verifyToken, allowedRoles(ADMIN), getInvitations);
router.get('/enrollments', verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), getEnrollment);
router.get('/enrollments/export', verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), exportEnrollments);
router.get('/dashboard/stats', verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), getDashboardStats);
router.get('/enrollments/:client_id', verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), verifyClientAccess, getEnrollmentDetails);
router.get('/enrollments/:client_id/agreements',verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), verifyClientAccess, getEnrollmentAgreements);
router.put('/enrollments/:client_id', verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), verifyClientAccess, validateEnrollmentUpdate, editEnrollment);
router.delete('/invitations/:invitation_id', verifyToken, allowedRoles(ADMIN), revokeInvitation)


export default router;