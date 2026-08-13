import crypto from "crypto";
import { poolPromise } from "../config/db.js";
import InvitationModel from "../models/invitationModel.js";
import { AppError } from "../utils/AppError.js";
import { sendInvitationEmail } from "./emailService.js";
import config from "../config/env.js";

const sendInvitations = async (userId, emails) => {
  const pool = await poolPromise;

  const employers = await InvitationModel.getEmployersByUser(pool, userId);
  if (employers.length === 0)
    throw new AppError("No company is assigned to your account", 403);

  const employer = employers[0];

  const results = [];

  for (let email of emails) {
    const token = crypto.randomBytes(32).toString("hex");

    try {
      const invitationId = await InvitationModel.createInvitation(pool, {
        employer_id: employer.employer_id,
        email_address: email,
        token,
        created_by: userId,
      });

      try {
        await sendInvitationEmail({
          to: email,
          companyName: employer.company_name,
          enrollmentUrl: `${config.appUrl}?token=${token}`,
        });

        results.push({ email, status: "sent", invitationId });
      } catch (error) {
        console.error("Invitation email failed:", {
          email,
          invitationId,
          error,
        });
        results.push({ email, status: "email_failed", invitationId });
      }

      
    } catch(error) {
      const number = error.number ?? error.originalError?.number;
      if (number === 50064) {
        results.push({ email, status: "already_invited" });
      } else {
        console.error("Invitation creation failed:", { email, error });
        results.push({ email, status: "failed" });
      }
    }
  }

  return results;
};

const revokeInvitation = async (userId, invitationId) => {
  const pool = await poolPromise;

  const invitations = await InvitationModel.getInvitationsByUser(pool, userId);
  const ownedIds = new Set(invitations.map(i => String(i.invitation_id)))
  if(!ownedIds.has(String(invitationId)))
    throw new AppError("Invitation does not belong to your company", 403);

  await InvitationModel.revokeInvitation(pool, invitationId, userId)
}


export default {
    sendInvitations,
    revokeInvitation
}