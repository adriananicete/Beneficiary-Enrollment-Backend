import { MAX_INVITATION_EMAILS } from "../utils/partitionEmails.js";

// Only the failures that make the request itself unusable belong here. Bad rows
// inside the batch are classified in the service and reported per address, so a
// single typo no longer rejects an entire upload.
export const validateInvitations = (req, res, next) => {
  const { emails } = req.body;

  if (!Array.isArray(emails))
    return res.status(400).json({ error: "emails must be an array" });

  if (emails.length === 0)
    return res
      .status(400)
      .json({ error: "At least one email address is required" });

  if (emails.length > MAX_INVITATION_EMAILS)
    return res.status(400).json({
      error: `A maximum of ${MAX_INVITATION_EMAILS} email addresses is allowed`,
    });

  next();
};
