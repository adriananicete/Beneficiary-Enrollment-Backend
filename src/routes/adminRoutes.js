import express from 'express';
import { allowedRoles } from '../middlewares/allowedRoles.js';
import { verifyToken } from '../middlewares/verifyToken.js';
import { exportEnrollments, getCompanyAffiliates, getCompanyClassifications, getDashboardStats, getEnrollment, getEnrollmentAgreements, getEnrollmentDetails, getEnrollmentSignature, resendCertificate, resendCredentials } from '../controllers/adminController.js';
import { ADMIN, SUPER_ADMIN } from '../utils/constants.js';
import { verifyClientAccess } from '../middlewares/verifyClientAccess.js';
import { cancelInvitationJob, getInvitationJobStatus, getInvitations, resendInvitation, revokeInvitation, sendInvitations } from '../controllers/invitationController.js';
import { validateInvitations } from '../middlewares/validateInvitations.js';
import { bulkInvitationLimiter, certificateResendLimiter, claimSubmitLimiter, credentialsResendLimiter, jobStatusLimiter, messageSendLimiter, pendingCountLimiter } from '../middlewares/rateLimiter.js';
import { getChangeRequestDetails, getChangeRequests, getPendingChangeRequestCount, reviewChangeRequest } from '../controllers/changeRequestController.js';
import { validateIdParam } from '../middlewares/validateIdParam.js';
import { getEmployerSettings, updateEmployerSettings } from '../controllers/employerSettingsController.js';
import { closeDeathClaim, fileDeathClaim, getClaimDetails, getClaimDocument, getClaims, getHrClaimTypes, getPendingClaimCount, reviewClaim } from '../controllers/claimController.js';
import { parseDocuments } from '../middlewares/parseDocuments.js';
import { getConversation, getConversations, getUnreadMessageCount, markConversationRead, openConversation, sendMessage } from '../controllers/messageController.js';
import { markDeceased, undoDeceased } from '../controllers/deceasedController.js';
import { createAffiliate, createClassification, createCompany, createHrAccount, getAffiliates, getClassificationSchedule, getCompanies, getCompany, resendHrCredentials, updateAffiliate, updateClassification, updateCompany } from '../controllers/companyController.js';
import { validateHrAccount } from '../middlewares/validateHrAccount.js';
import { validateCompanyChanges, validateNewCompany } from '../middlewares/validateCompany.js';
import { validateClassificationChanges, validateNewClassification } from '../middlewares/validateClassification.js';
import { validateAffiliateChanges, validateNewAffiliate } from '../middlewares/validateAffiliate.js';

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
// HR's own company's classifications, for assigning one per invitation. HR
// only, like the invitation routes above, so allowedRoles(ADMIN).
router.get('/classifications', verifyToken, allowedRoles(ADMIN), getCompanyClassifications);
// HR's own company's active affiliates, DBA request 25, for the Affiliate
// column of its invitation file. HR only, as above.
router.get('/affiliates', verifyToken, allowedRoles(ADMIN), getCompanyAffiliates);
router.get('/enrollments', verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), getEnrollment);
router.get('/enrollments/export', verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), exportEnrollments);
router.get('/dashboard/stats', verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), getDashboardStats);
router.get('/enrollments/:client_id', verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), verifyClientAccess, getEnrollmentDetails);
router.get('/enrollments/:client_id/agreements',verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), verifyClientAccess, getEnrollmentAgreements);
// Same chain as the two above it, and verifyClientAccess is doing the whole of
// the company scoping — the procedure behind this takes a client_id and trusts
// it. Answers image bytes rather than JSON.
router.get('/enrollments/:client_id/signature', verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), verifyClientAccess, getEnrollmentSignature);
router.post('/enrollments/:client_id/resend-credentials', verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), verifyClientAccess, credentialsResendLimiter, resendCredentials);
// The same chain as resend-credentials. verifyClientAccess is the whole of the
// company scoping: usp_get_insurance_enrollment_by_id takes a client_id and
// trusts it, so without it an HR could mail any company's certificate out.
router.post('/enrollments/:client_id/resend-certificate', verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), verifyClientAccess, certificateResendLimiter, resendCertificate);
// Deceased status, DBA request 21. HR and the Administrator mark it or correct
// the date; only the Administrator undoes it (decided 2026-10-06). Both behind
// verifyClientAccess, and the procedures scope again.
router.post('/enrollments/:client_id/deceased', verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), verifyClientAccess, markDeceased);
router.delete('/enrollments/:client_id/deceased', verifyToken, allowedRoles(SUPER_ADMIN), verifyClientAccess, undoDeceased);
// The death claim, DBA request 21. Filed by HR or the Administrator for an
// employee already marked deceased, approved on filing. The upload is read
// only after the session, the role, the company and the limiter have passed,
// as on the employee's claim route.
router.post('/enrollments/:client_id/death-claim', verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), verifyClientAccess, claimSubmitLimiter, parseDocuments, fileDeathClaim);
// /pending-count is declared before /:request_id on purpose. Express matches in
// order, so the param route would otherwise swallow it and try to read
// "pending-count" as an id.
router.get('/change-requests', verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), getChangeRequests);
router.get('/change-requests/pending-count', verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), pendingCountLimiter, getPendingChangeRequestCount);
router.get('/change-requests/:request_id', verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), changeRequestId, getChangeRequestDetails);
router.patch('/change-requests/:request_id', verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), changeRequestId, reviewChangeRequest);
router.delete('/invitations/:invitation_id', verifyToken, allowedRoles(ADMIN), invitationId, revokeInvitation)
// Per-company settings: the automatic Certificate of Coverage email. HR and the
// Administrator both; the procedures scope HR to their own company.
router.get('/employers/settings', verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), getEmployerSettings);
router.patch('/employers/:employer_id/settings', verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), validateIdParam('employer_id', 'Company not found'), updateEmployerSettings);

// Companies, DBA request 24: the Administrator lists, creates and edits them.
// The Administrator only (SUPER_ADMIN); the procedures refuse anybody else
// again (50182).
const companyId = validateIdParam('employer_id', 'Company not found');

router.get('/companies', verifyToken, allowedRoles(SUPER_ADMIN), getCompanies);
router.post('/companies', verifyToken, allowedRoles(SUPER_ADMIN), validateNewCompany, createCompany);
router.get('/companies/:employer_id', verifyToken, allowedRoles(SUPER_ADMIN), companyId, getCompany);
router.patch('/companies/:employer_id', verifyToken, allowedRoles(SUPER_ADMIN), companyId, validateCompanyChanges, updateCompany);

// A company's schedule: its classes and their amounts, DBA request 24. The
// Administrator only. The edit route sits under the company (option A,
// 2026-10-15): the class is found in its company's schedule, and a class of
// another company is 404.
const classificationId = validateIdParam('classification_id', 'Classification not found');

router.get('/companies/:employer_id/classifications', verifyToken, allowedRoles(SUPER_ADMIN), companyId, getClassificationSchedule);
router.post('/companies/:employer_id/classifications', verifyToken, allowedRoles(SUPER_ADMIN), companyId, validateNewClassification, createClassification);
router.patch('/companies/:employer_id/classifications/:classification_id', verifyToken, allowedRoles(SUPER_ADMIN), companyId, classificationId, validateClassificationChanges, updateClassification);

// The company's one HR account, DBA request 24, branch 4. The Administrator
// only. The reissue shares credentialsResendLimiter with HR's employee
// resend: both send a password by email.
router.post('/companies/:employer_id/hr-account', verifyToken, allowedRoles(SUPER_ADMIN), companyId, validateHrAccount, createHrAccount);
router.post('/companies/:employer_id/hr-account/resend-credentials', verifyToken, allowedRoles(SUPER_ADMIN), companyId, credentialsResendLimiter, resendHrCredentials);

// A company's affiliates, DBA request 25, branch 5. The Administrator only.
// The edit route sits under the company, as the class edit does (option A,
// 2026-10-15): no procedure reads one affiliate by id, so it is found in its
// company's list, and an affiliate of another company is 404.
const affiliateId = validateIdParam('affiliate_id', 'Affiliate not found');

router.get('/companies/:employer_id/affiliates', verifyToken, allowedRoles(SUPER_ADMIN), companyId, getAffiliates);
router.post('/companies/:employer_id/affiliates', verifyToken, allowedRoles(SUPER_ADMIN), companyId, validateNewAffiliate, createAffiliate);
router.patch('/companies/:employer_id/affiliates/:affiliate_id', verifyToken, allowedRoles(SUPER_ADMIN), companyId, affiliateId, validateAffiliateChanges, updateAffiliate);

// Claims, DBA request 20: HR's review. The procedures scope HR to their own
// companies and let the Administrator see every one, as with change requests.
// /pending-count is declared before /:claim_id for the reason given above.
// It shares pendingCountLimiter with the change request badge: two badges
// polled every thirty seconds are sixty requests in its window of 300.
const claimId = validateIdParam('claim_id', 'Claim not found');

router.get('/claim-types', verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), getHrClaimTypes);
router.get('/claims', verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), getClaims);
router.get('/claims/pending-count', verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), pendingCountLimiter, getPendingClaimCount);
router.get('/claims/:claim_id', verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), claimId, getClaimDetails);
router.get('/claims/:claim_id/documents/:document_id', verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), validateIdParam('claim_id', 'Document not found'), validateIdParam('document_id', 'Document not found'), getClaimDocument);
router.patch('/claims/:claim_id', verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), claimId, reviewClaim);
// Closes the death claim and the employee's account. The procedure accepts
// only an APPROVED death claim in the caller's companies (50167).
router.patch('/claims/:claim_id/close', verifyToken, allowedRoles(ADMIN, SUPER_ADMIN), claimId, closeDeathClaim);

// Messaging, DBA request 22. HR only: the Administrator has no access in v1
// (decided 2026-10-12), so these carry allowedRoles(ADMIN), which is HR.
// The procedures scope HR to their own companies. /conversations/unread-count
// is declared before /conversations/:conversation_id for the reason above.
const conversationId = validateIdParam('conversation_id', 'Conversation not found');

router.get('/conversations', verifyToken, allowedRoles(ADMIN), getConversations);
router.post('/conversations', verifyToken, allowedRoles(ADMIN), openConversation);
router.get('/conversations/unread-count', verifyToken, allowedRoles(ADMIN), pendingCountLimiter, getUnreadMessageCount);
router.get('/conversations/:conversation_id', verifyToken, allowedRoles(ADMIN), conversationId, getConversation);
router.post('/conversations/:conversation_id/messages', verifyToken, allowedRoles(ADMIN), conversationId, messageSendLimiter, sendMessage);
router.post('/conversations/:conversation_id/read', verifyToken, allowedRoles(ADMIN), conversationId, markConversationRead);


export default router;