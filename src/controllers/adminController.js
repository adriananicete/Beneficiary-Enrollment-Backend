import EnrollmentService from "../services/enrollmentService.js";
import ClientModel from "../models/clientModel.js";
import { generateExcelReport } from "../services/exportService.js";
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

export const editEnrollment = async (req, res, next) => {
    try {
        const { client_id } = req.params;
        const { user_id } = req.user;

        console.log('1 CONTROLLER barangay_id:', req.body.barangay_id);

        const {
            first_name, middle_name, last_name, suffix,
            birthdate, birthplace, nationality, tin_id,
            civil_status, gender, height, weight,
            sss_gsis_no, contact_no, email_address,
            occupation, source_of_income, signature_path,
            client_address_id, barangay_id, address_line, zip_code,
            beneficiaries
        } = req.body;

        await EnrollmentService.updateEnrollment(user_id, {
            client_id,
            first_name, middle_name, last_name, suffix,
            birthdate, birthplace, nationality, tin_id,
            civil_status, gender, height, weight,
            sss_gsis_no, contact_no, email_address,
            occupation, source_of_income, signature_path,
            client_address_id, barangay_id, address_line, zip_code,
            beneficiaries
        });

        return res.status(200).json({
            success: true,
            message: 'Enrollment updated successfully'
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

  return res.status(501).json({ message: 'Not implemented yet' });
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

  return res.status(501).json({ message: 'Not implemented yet' });
};
