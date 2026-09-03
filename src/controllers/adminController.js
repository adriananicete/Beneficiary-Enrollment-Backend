import EnrollmentService from "../services/enrollmentService.js";
import AgreementModel from "../models/agreementModel.js";
import ClientModel from "../models/clientModel.js";
import { poolPromise } from "../config/db.js";

export const getEnrollment = async (req, res, next) => {
  try {
    const { user_id } = req.user;

    const pool = await poolPromise;

    const getEnrollementData = await ClientModel.getHrEmployees(pool, user_id);

    return res.status(200).json({
      success: true,
      data: getEnrollementData,
    });
  } catch (error) {
    next(error);
  }
};

export const getEnrollmentDetails = async (req, res, next) => {
  try {
    const { client_id } = req.params;

    const pool = await poolPromise;

    const enrollmentData = await EnrollmentService.getFullEnrollmentDetails(
      pool,
      client_id,
    );

    return res.status(200).json({
      success: true,
      data: enrollmentData,
    });
  } catch (error) {
    next(error);
  }
};

export const exportEnrollments = async (req, res) => {
  // try {
  //   const { companyID, role } = req.user;

  //   const pool = await poolPromise;

  //   const getExcelReport = await EnrollmentModel.getEnrollmentsForExport(
  //     pool,
  //     companyID,
  //     role,
  //   );

  //   const enrollmentReport = generateExcelReport(getExcelReport);

  //   res.setHeader(
  //     "Content-Type",
  //     "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  //   );

  //   res.setHeader(
  //     "Content-Disposition",
  //     "attachment; filename=enrollments.xlsx",
  //   );

  //   await enrollmentReport.xlsx.write(res);

  //   res.end();
  // } catch (error) {
  //   console.error(error);
  //   return res.status(500).json({ error: error.message });
  // }

  return res.status(501).json({ success: false, message: "Not implemented yet" });
};

export const getDashboardStats = async (req, res) => {
  // try {
  //   const { companyID, role } = req.user;

  //   const pool = await poolPromise;

  //   const dashBoardStats = await EnrollmentModel.getEnrollmentStats(
  //     pool,
  //     companyID,
  //     role,
  //   );

  //   return res.status(200).json({
  //     success: true,
  //     data: dashBoardStats,
  //   });
  // } catch (error) {
  //   console.error(error);
  //   return res.status(500).json({ error: error.message });
  // }

  return res.status(501).json({ success: false, message: "Not implemented yet" });
};

export const getEnrollmentAgreements = async (req, res, next) => {
  try {
    const { client_id } = req.params;
    const pool = await poolPromise;
    const agreements = await AgreementModel.getClientAgreements(
      pool,
      client_id,
    );

    return res.status(200).json({
      success: true,
      data: agreements,
    });
  } catch (error) {
    next(error);
  }
};
