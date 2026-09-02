import { AppError } from "../utils/AppError.js";
import { MAX_INVITATION_EMAILS } from "../utils/partitionEmails.js";

// Only the failures that make the request itself unusable belong here. Bad rows
// inside the batch are classified in the service and reported per address, so a
// single typo no longer rejects an entire upload.
export const validateInvitations = (req, res, next) => {
  const { emails } = req.body;

  if (!Array.isArray(emails))
    return next(new AppError("emails must be an array", 400));

  if (emails.length === 0)
    return next(new AppError("At least one email address is required", 400));

  if (emails.length > MAX_INVITATION_EMAILS)
    return next(
      new AppError(
        `A maximum of ${MAX_INVITATION_EMAILS} email addresses is allowed`,
        400,
      ),
    );

  next();
};
