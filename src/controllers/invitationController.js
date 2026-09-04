import InvitationService from '../services/invitationService.js';
import { parsePaging } from '../utils/parsePaging.js';

// "0" and "1" only. Anything else means no filter, including an absent
// parameter — and the check has to be written against the strings, because
// Number("0") is falsy and would read as absent when it is the one value HR
// filters on most.
const parseIsEnrolled = (value) => {
    if (value === '0') return 0;
    if (value === '1') return 1;

    return null;
};

// An empty search is no search. Passing "" through would reach the procedure as
// LIKE '%%', which matches every row and pays for a scan to do it.
const parseSearch = (value) => {
    if (typeof value !== 'string') return null;

    const trimmed = value.trim();

    return trimmed === '' ? null : trimmed;
};

export const getInvitations = async (req, res, next) => {
    try {
        const { user_id } = req.user;
        const { page, pageSize } = parsePaging(req.query);

        const userInvitation = await InvitationService.getInvitations(user_id, {
            page,
            pageSize,
            isEnrolled: parseIsEnrolled(req.query.is_enrolled),
            status: req.query.status ?? null,
            sendStatus: req.query.send_status ?? null,
            search: parseSearch(req.query.search)
        });

        return res.status(200).json({
            success: true,
            data: userInvitation
        })
    } catch (error) {
        next(error);
    }
};

export const sendInvitations = async (req, res, next) => {
    try {
        const { user_id } = req.user;
        const { emails } = req.body;

        const job = await InvitationService.sendInvitations(user_id, emails);

        // 202: the addresses have been accepted, the sending happens behind this.
        return res.status(202).json({
            success: true,
            data: job
        })
    } catch (error) {
        next(error);
    }
};

export const getInvitationJobStatus = async (req, res, next) => {
    try {
        const { user_id } = req.user;
        const { job_id } = req.params;

        // Anything that is not a positive whole number means "from the start".
        const requested = Number(req.query.since);
        const since = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 0;

        const job = InvitationService.getInvitationJobStatus(user_id, job_id, since);

        return res.status(200).json({
            success: true,
            data: job
        })
    } catch (error) {
        next(error);
    }
};

export const cancelInvitationJob = async (req, res, next) => {
    try {
        const { user_id } = req.user;
        const { job_id } = req.params;

        const job = InvitationService.cancelInvitationJob(user_id, job_id);

        return res.status(202).json({
            success: true,
            data: job
        })
    } catch (error) {
        next(error);
    }
};

export const revokeInvitation = async (req, res, next) => {
    try {
        const { user_id } = req.user;
        const { invitation_id } = req.params;

        await InvitationService.revokeInvitation(user_id, invitation_id);

        return res.status(200).json({
            success: true,
            message: 'Invitation revoked successfully'
        })
    } catch (error) {
        next(error)
    }
};

export const resendInvitation = async (req, res, next) => {
    try {
        const { user_id } = req.user;
        const { invitation_id } = req.params;

        const resend = await InvitationService.resendInvitation(user_id, invitation_id);

        return res.status(200).json({
            success: true,
            data: { status: resend.status }
        })
    } catch (error) {
        next(error);
    }
}