import { poolPromise } from '../config/db.js';
import InvitationModel from '../models/invitationModel.js';
import InvitationService from '../services/invitationService.js';

export const getInvitations = async (req, res, next) => {
    try {
        const { user_id } = req.user;
        const pool = await poolPromise;

        const userInvitation = await InvitationModel.getInvitationsByUser(pool, user_id);

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

        const results = await InvitationService.sendInvitations(user_id, emails);

        return res.status(200).json({
            success: true,
            data: results
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