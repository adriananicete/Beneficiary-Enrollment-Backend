import express from 'express';
import { allowedRoles } from '../middlewares/allowedRoles.js';
import { verifyToken } from '../middlewares/verifyToken.js';
import { editEnrollment, exportEnrollments, getDashboardStats, getEnrollment, getEnrollmentAgreements, getEnrollmentDetails } from '../controllers/adminController.js';
import { ADMIN, SUPER_ADMIN } from '../utils/constants.js';
import { verifyClientAccess } from '../middlewares/verifyClientAccess.js';
import { validateEnrollmentUpdate } from '../middlewares/validateEnrollmentUpdate.js';
import { cancelInvitationJob, getInvitationJobStatus, getInvitations, resendInvitation, revokeInvitation, sendInvitations } from '../controllers/invitationController.js';
import { validateInvitations } from '../middlewares/validateInvitations.js';
import { bulkInvitationLimiter, jobStatusLimiter } from '../middlewares/rateLimiter.js';

const router = express.Router();

router.post('/invitations/:invitation_id/resend', verifyToken, allowedRoles(ADMIN), resendInvitation);
router.post('/invitations', verifyToken, allowedRoles(ADMIN), bulkInvitationLimiter, validateInvitations, sendInvitations)
router.post('/invitations/jobs/:job_id/cancel', verifyToken, allowedRoles(ADMIN), cancelInvitationJob);
router.get('/invitations/jobs/:job_id', verifyToken, allowedRoles(ADMIN), jobStatusLimiter, getInvitationJobStatus);
router.get('/invitations', verifyToken, allowedRoles(ADMIN), getInvitations);
router.get('/enrollments', verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), getEnrollment);
router.get('/enrollments/export', verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), exportEnrollments);
router.get('/dashboard/stats', verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), getDashboardStats);
router.get('/enrollments/:client_id', verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), verifyClientAccess, getEnrollmentDetails);
router.get('/enrollments/:client_id/agreements',verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), verifyClientAccess, getEnrollmentAgreements);
router.put('/enrollments/:client_id', verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), verifyClientAccess, validateEnrollmentUpdate, editEnrollment);
router.delete('/invitations/:invitation_id', verifyToken, allowedRoles(ADMIN), revokeInvitation)


export default router;