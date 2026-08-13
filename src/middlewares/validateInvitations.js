export const validateInvitations = (req, res, next) => {
  const { emails } = req.body;
  if (!Array.isArray(emails))
    return res.status(400).json({ error: "emails must be an array" });
  if (emails.length === 0)
    return res
      .status(400)
      .json({ error: "At least one email address is required" });
  if (emails.length > 20)
    return res
      .status(400)
      .json({ error: "A maximum of 20 email addresses is allowed" });

  for (let i = 0; i < emails.length; i++) {
    if (
      typeof emails[i] !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emails[i])
    )
      return res
        .status(400)
        .json({ error: `Email ${i + 1}: must be a valid email address` });
    if (emails[i].length > 150)
      return res.status(400).json({
        error: `Email ${i + 1}: must not exceed 150 characters`,
      });
  }

  const unique = new Set(emails.map((e) => e.toLowerCase()));
  if (unique.size !== emails.length)
    return res.status(400).json({
      error: "Duplicate email addresses are not allowed in the same batch",
    });

  next();
};
