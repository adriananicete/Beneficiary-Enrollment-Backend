import { poolPromise } from '../config/db.js';
import InvitationModel from '../models/invitationModel.js';

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
}