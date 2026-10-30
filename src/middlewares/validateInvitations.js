import { AppError } from "../utils/AppError.js";
import { MAX_INVITATION_EMAILS } from "../utils/partitionInvitations.js";

// Only the failures that make the request itself unusable belong here. Bad rows
// inside the batch are classified in the service and reported per row, so a
// single typo no longer rejects an entire upload.
export const validateInvitations = (req, res, next) => {
  const { invitations, emails } = req.body ?? {};

  // The shape before branch 6 of the onboarding effort. Named, so a frontend
  // still sending it learns what changed rather than reading "must be an array".
  if (invitations === undefined && emails !== undefined)
    return next(
      new AppError(
        "emails is no longer accepted. Send invitations: [{ email_address, classification_code, affiliate_code }]",
        400,
      ),
    );

  if (!Array.isArray(invitations))
    return next(new AppError("invitations must be an array", 400));

  if (invitations.length === 0)
    return next(new AppError("At least one invitation is required", 400));

  if (invitations.length > MAX_INVITATION_EMAILS)
    return next(
      new AppError(
        `A maximum of ${MAX_INVITATION_EMAILS} invitations is allowed`,
        400,
      ),
    );

  next();
};
