import { sql, poolPromise } from "../config/db.js";
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

export const getEnrollmentDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const { companyID, role } = req.admin;

    const pool = await poolPromise;

    const enrollmentDetails = await EnrollmentModel.getEnrollmentById(pool, id);

    if (!enrollmentDetails.enrollment)
      return res.status(404).json({ error: "Enrollment ID not found" });

    if (
      role === "admin" &&
      enrollmentDetails.enrollment?.CompanyID !== companyID
    )
      return res.status(403).json({ error: "Forbidden" });

    return res.status(200).json({
      success: true,
      data: enrollmentDetails,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
};

export const editEnrollment = async (req, res) => {
  let transaction;
  try {
    const { id } = req.params;
    const { companyID, role } = req.admin;

    if (role === "superadmin")
      return res.status(403).json({ error: "Cannot access this action" });

    const pool = await poolPromise;

    const enrollment = await EnrollmentModel.getEnrollmentById(pool, id);

    if (!enrollment) return res.status(404).json({ error: "User not found" });

    if (enrollment.enrollment.CompanyID !== companyID)
      return res.status(403).json({ error: "Forbidden" });

    if (req.body.beneficiaries.length !== enrollment.beneficiaries.length)
      return res.status(400).json({ error: "Beneficiary count mismatch" });

    transaction = new sql.Transaction(pool);
    await transaction.begin();

    const updatedEnrollment = await EnrollmentModel.updateEnrollment(
      transaction,
      id,
      req.body,
    );

    for (let beneficiary of req.body.beneficiaries) {
      await EnrollmentModel.updateBeneficiary(
        transaction,
        beneficiary.beneficiaryId,
        beneficiary,
      );
    }

    await transaction.commit();

    return res.status(200).json({
      success: true,
      message: `Enrollment form: ${enrollment.enrollment?.ReferenceNumber} updated succesfully`
    })
  } catch (error) {
    console.error(error);
    if (transaction) await transaction.rollback();
    return res.status(500).json({error: error.message})
  }
};
