import express from 'express';
import { allowedRoles } from '../middlewares/allowedRoles.js';
import { verifyToken } from '../middlewares/verifyToken.js';
import { exportEnrollments, getDashboardStats, getEnrollment, getEnrollmentAgreements, getEnrollmentDetails, resendCredentials } from '../controllers/adminController.js';
import { ADMIN, SUPER_ADMIN } from '../utils/constants.js';
import { verifyClientAccess } from '../middlewares/verifyClientAccess.js';
import { cancelInvitationJob, getInvitationJobStatus, getInvitations, resendInvitation, revokeInvitation, sendInvitations } from '../controllers/invitationController.js';
import { validateInvitations } from '../middlewares/validateInvitations.js';
import { bulkInvitationLimiter, credentialsResendLimiter, jobStatusLimiter, pendingCountLimiter } from '../middlewares/rateLimiter.js';
import { getChangeRequestDetails, getChangeRequests, getPendingChangeRequestCount, reviewChangeRequest } from '../controllers/changeRequestController.js';
import { validateIdParam } from '../middlewares/validateIdParam.js';

const router = express.Router();

// Shared by the three routes that take a change request id. Declared once so
// the message cannot drift between them — it is the same 404 the controllers
// answer for a request that exists but is not the caller's.
const changeRequestId = validateIdParam('request_id', 'Change request not found');

// Same for the two invitation routes that take an id. job_id is not covered:
// it is a job identifier held in memory, never bound to the database.
const invitationId = validateIdParam('invitation_id', 'Enrollment invitation does not exist');

router.post('/invitations/:invitation_id/resend', verifyToken, allowedRoles(ADMIN), invitationId, resendInvitation);
router.post('/invitations', verifyToken, allowedRoles(ADMIN), bulkInvitationLimiter, validateInvitations, sendInvitations)
router.post('/invitations/jobs/:job_id/cancel', verifyToken, allowedRoles(ADMIN), cancelInvitationJob);
router.get('/invitations/jobs/:job_id', verifyToken, allowedRoles(ADMIN), jobStatusLimiter, getInvitationJobStatus);
router.get('/invitations', verifyToken, allowedRoles(ADMIN), getInvitations);
router.get('/enrollments', verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), getEnrollment);
router.get('/enrollments/export', verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), exportEnrollments);
router.get('/dashboard/stats', verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), getDashboardStats);
router.get('/enrollments/:client_id', verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), verifyClientAccess, getEnrollmentDetails);
router.get('/enrollments/:client_id/agreements',verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), verifyClientAccess, getEnrollmentAgreements);
router.post('/enrollments/:client_id/resend-credentials', verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), verifyClientAccess, credentialsResendLimiter, resendCredentials);
// /pending-count is declared before /:request_id on purpose. Express matches in
// order, so the param route would otherwise swallow it and try to read
// "pending-count" as an id.
router.get('/change-requests', verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), getChangeRequests);
router.get('/change-requests/pending-count', verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), pendingCountLimiter, getPendingChangeRequestCount);
router.get('/change-requests/:request_id', verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), changeRequestId, getChangeRequestDetails);
router.patch('/change-requests/:request_id', verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), changeRequestId, reviewChangeRequest);
router.delete('/invitations/:invitation_id', verifyToken, allowedRoles(ADMIN), invitationId, revokeInvitation)


export default router;