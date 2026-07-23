import { poolPromise } from "../config/db.js";
import ReferenceModel from "../models/referenceModel.js";
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
    next(error);
  }
};

export const getBarangays = async (req, res, next) => {
  try {
    const pool = await poolPromise;
    const barangays = await ReferenceModel.getBarangays(pool);
    return res.status(200).json({
      success: true,
      data: barangays
    })
  } catch (error) {
    next(error);
  }
};
