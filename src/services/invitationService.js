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

// The token is the credential that opens the enrollment form as the invited
// person. The backend needs it to rebuild the link on resend; a browser never
// does, so it is stripped before the list leaves the server.
const getInvitations = async (userId) => {
  const pool = await poolPromise;

  const invitations = await InvitationModel.getInvitationsByUser(pool, userId);

  return invitations.map(({ token, ...invitation }) => invitation);
};

// The SP caps last_send_error at 500 characters; Graph errors carry the whole
// response body and can run longer than that.
const MAX_SEND_ERROR_LENGTH = 500;

// Recording the outcome must never turn a delivered email into a failed
// request, so this swallows its own errors and only logs them.
const recordSendStatus = async (pool, invitationId, sendStatus, errorMessage, userId) => {
  const lastSendError = errorMessage
    ? String(errorMessage).slice(0, MAX_SEND_ERROR_LENGTH)
    : null;

  try {
    await InvitationModel.updateSendStatus(
      pool,
      invitationId,
      sendStatus,
      lastSendError,
      userId,
    );
  } catch (error) {
    console.error("Failed to record invitation send status:", {
      invitationId,
      sendStatus,
      error,
    });
  }
};

const revokeInvitation = async (userId, invitationId) => {
  const pool = await poolPromise;

  const invitations = await InvitationModel.getInvitationsByUser(pool, userId);
  const ownedIds = new Set(invitations.map(i => String(i.invitation_id)))
  if(!ownedIds.has(String(invitationId)))
    throw new AppError("Invitation does not belong to your company", 403);

  await InvitationModel.revokeInvitation(pool, invitationId, userId)
};

const resendInvitation = async (userId, invitationId) => {
  const pool = await poolPromise;
  const invitations = await InvitationModel.getInvitationsByUser(pool, userId);
  const invitation = invitations.find(i => String(i.invitation_id) === String(invitationId));
  if(!invitation) throw new AppError('Invitation does not belong to your company', 403);

  if(invitation.is_enrolled === 1) throw new AppError('This employee has already submitted an enrollment', 409);

  await InvitationModel.resendInvitation(pool, invitationId, userId);

  try {
        await sendInvitationEmail({
          to: invitation.email_address,
          companyName: invitation.company_name,
          enrollmentUrl: `${config.appUrl}?token=${invitation.token}`,
        });

        await recordSendStatus(pool, invitationId, "sent", null, userId);

        return { status: "sent"}
      } catch (error) {
        console.error("Invitation resend failed:", { email: invitation.email_address, invitationId, error });

        await recordSendStatus(pool, invitationId, "failed", error?.message, userId);

        return { status: "email_failed"}
      }
};


export default {
    sendInvitations,
    getInvitations,
    revokeInvitation,
    resendInvitation
}