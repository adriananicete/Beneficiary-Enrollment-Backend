import { createEnrollment } from "../services/enrollmentService.js";

export const submitEnrollment = async (req, res) => {
  try {
    const enrollmentFormId = await createEnrollment(req.body);

    return res.status(201).json({
      success: true,
      referenceNumber: enrollmentFormId,
      message: "Enrollment submitted successfully",
    });
  } catch (error) {
    if (error.message.includes("already exists")) {
      return res.status(409).json({ error: error.message });
    }
    return res.status(500).json({ error: error.message });
  }
};
