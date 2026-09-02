import InvitationService from '../services/invitationService.js';

export const getInvitations = async (req, res, next) => {
    try {
        const { user_id } = req.user;

        const userInvitation = await InvitationService.getInvitations(user_id);

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

        const { status } = resend;

        return res.status(200).json({
            success: true,
            status: status
        })
    } catch (error) {
        next(error);
    }
}