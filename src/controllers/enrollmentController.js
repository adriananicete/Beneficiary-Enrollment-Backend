import EnrollmentService from "../services/enrollmentService.js";

export const submitEnrollment = async (req, res, next) => {
  try {
    const { clientId, enrollmentId } = await EnrollmentService.createEnrollment(
      {
        ...req.body,
        ip_address: req.ip,
        user_agent: req.headers["user-agent"],
      },
    );

    return res.status(201).json({
      success: true,
      referenceNumber: enrollmentId,
      message: "Enrollment submitted successfully",
    });
  } catch (error) {
    const originalMessage = error.originalError?.message || error.message;
    if (
      originalMessage.includes("already exists") ||
      originalMessage.includes("duplicate")
    ) {
      return res.status(409).json({ error: originalMessage });
    }
    next(error);
  }
};
