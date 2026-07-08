import { poolPromise } from "../config/db.js";
import EnrollmentModel from "../models/enrollmentModel.js";

export const getEnrollment = async (req, res) => {
  try {
    const { companyID, role } = req.admin;
    const { search, page, limit } = req.query;

    const pool = await poolPromise;

    const parsedPage = Number(page) || 1;
    const parsedLimit = Number(limit) || 10;

    const getEnrollementData = await EnrollmentModel.getEnrollmentsByCompany(
      pool,
      companyID,
      role,
      search,
      parsedPage,
      parsedLimit,
    );

    return res.status(200).json({
      success: true,
      data: getEnrollementData,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
};
