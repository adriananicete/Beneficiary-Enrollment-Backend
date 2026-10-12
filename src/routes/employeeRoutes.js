import express from 'express';
import { getMyEnrollment, login, logout, changePassword } from '../controllers/employeeController.js';
import { verifyToken } from '../middlewares/verifyToken.js';
import { allowedRoles } from '../middlewares/allowedRoles.js';
import { EMPLOYEE } from '../utils/constants.js';
import { verifyResetToken } from '../middlewares/verifyResetToken.js';
import { authIpLimiter, claimSubmitLimiter, passwordChangeLimiter, strictLimiter } from '../middlewares/rateLimiter.js';
import { getMyAgreements, getMySignature } from '../controllers/enrollmentController.js';
import { validateEnrollmentUpdate } from '../middlewares/validateEnrollmentUpdate.js';
import { validateIdParam } from '../middlewares/validateIdParam.js';
import { cancelMyChangeRequest, getMyChangeRequests, submitChangeRequest } from '../controllers/changeRequestController.js';
import { parseDocuments } from '../middlewares/parseDocuments.js';
import {
    cancelMyClaim,
    getMyClaim,
    getMyClaimDocument,
    getMyClaims,
    getMyClaimTypes,
    resubmitMyClaim,
    submitMyClaim,
} from '../controllers/claimController.js';

const router = express.Router();

router.post('/login', authIpLimiter, strictLimiter, login);
router.post('/logout', logout);
// The limiter counts per username from the reset token, so it runs after
// verifyResetToken. See passwordChangeLimiter.
router.post('/change-password', authIpLimiter, verifyResetToken, passwordChangeLimiter, changePassword);
router.get('/enrollment', verifyToken, allowedRoles(EMPLOYEE), getMyEnrollment);
router.get('/agreements', verifyToken, allowedRoles(EMPLOYEE), getMyAgreements);
// No id in the path and nothing to scope: the client_id comes from the
// caller's own user row.
router.get('/signature', verifyToken, allowedRoles(EMPLOYEE), getMySignature);
router.post('/change-requests', verifyToken, allowedRoles(EMPLOYEE), validateEnrollmentUpdate, submitChangeRequest);
router.get('/change-requests', verifyToken, allowedRoles(EMPLOYEE), getMyChangeRequests);
router.patch('/change-requests/:request_id/cancel', verifyToken, allowedRoles(EMPLOYEE), validateIdParam('request_id', 'Change request not found'), cancelMyChangeRequest);

// Claims, DBA request 20. The client_id always comes from the caller's own
// user row. The upload is parsed only after the session, the role and the
// limiter have passed, so nobody unauthenticated gets up to 50MB held in
// memory.
router.get('/claim-types', verifyToken, allowedRoles(EMPLOYEE), getMyClaimTypes);
router.post('/claims', verifyToken, allowedRoles(EMPLOYEE), claimSubmitLimiter, parseDocuments, submitMyClaim);
router.get('/claims', verifyToken, allowedRoles(EMPLOYEE), getMyClaims);
router.get('/claims/:claim_id', verifyToken, allowedRoles(EMPLOYEE), validateIdParam('claim_id', 'Claim not found'), getMyClaim);
router.get('/claims/:claim_id/documents/:document_id', verifyToken, allowedRoles(EMPLOYEE), validateIdParam('claim_id', 'Document not found'), validateIdParam('document_id', 'Document not found'), getMyClaimDocument);
router.patch('/claims/:claim_id/cancel', verifyToken, allowedRoles(EMPLOYEE), validateIdParam('claim_id', 'No open claim found'), cancelMyClaim);
// A returned claim, with more documents, back to PENDING. The id is checked
// before the limiter and the upload, so a bad URL costs nothing to read.
router.post('/claims/:claim_id/resubmit', verifyToken, allowedRoles(EMPLOYEE), validateIdParam('claim_id', 'Claim not found'), claimSubmitLimiter, parseDocuments, resubmitMyClaim);

export default router;