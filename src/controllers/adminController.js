import EnrollmentService from "../services/enrollmentService.js";
import AgreementModel from "../models/agreementModel.js";
import ClientModel from "../models/clientModel.js";
import UserModel from "../models/userModel.js";
import ExportService from "../services/exportService.js";
import { poolPromise } from "../config/db.js";
import { AppError } from "../utils/AppError.js";
import { sendCredentialsEmail } from "../services/emailService.js";
import bcrypt from "bcrypt";
import crypto from "crypto";

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

// HR reissues an employee's credentials. The employee cannot start this
// themselves on purpose: the failure that matters is a wrong or unreachable
// email address, and a self-service page would send the message to the same
// address that already failed. HR can confirm who they are speaking to first.
//
// This exists because the employee is now the only person who can propose a
// change to their own record. An employee who cannot sign in has a record
// nobody can correct — see PARK.md.
export const resendCredentials = async (req, res, next) => {
  try {
    const { client_id } = req.params;
    const { user_id } = req.user;

    const pool = await poolPromise;

    const user = await UserModel.findUserByClientId(pool, client_id);
    if (!user)
      throw new AppError("No active account found for this employee", 404);

    if (!user.us01_email_address)
      throw new AppError(
        "This account has no email address on file. Correct it before resending.",
        409,
      );

    const tempPassword = crypto.randomBytes(9).toString("base64").slice(0, 12);
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    // Send before writing. The order is the whole design of this endpoint.
    //
    // Every other sender in this codebase swallows its failures, because there
    // the record is what matters and the email is a courtesy. Here the email IS
    // the delivery — it carries the only copy of the password. Changing the
    // password first and then failing to send would lock the employee out
    // harder than before, with a credential nobody knows.
    //
    // So the send goes first and a failure means nothing was changed. The cost
    // is the opposite risk: mail accepted, write fails, and the employee holds a
    // password that was never stored. That case is logged loudly below, and it
    // is recoverable by resending — the reverse is not.
    try {
      await sendCredentialsEmail({
        to: user.us01_email_address,
        firstName: user.us01_first_name,
        username: user.us01_username,
        password: tempPassword,
      });
    } catch (error) {
      // Caught only to say what is true. graphSendError returns a plain Error,
      // which errorHandler renders as "Server Error" — leaving HR unable to tell
      // whether the password changed. They would either pass on a password that
      // does not exist, or press resend until something gives.
      console.error(
        `Credentials email failed for user ${user.us01_user_id} (client ${client_id}). ` +
          `Nothing was changed.`,
        error,
      );
      throw new AppError(
        "The email could not be sent, so nothing was changed. The employee's current password still works. Please try again.",
        502,
      );
    }

    const rowsUpdated = await UserModel.resetPassword(pool, {
      us01_user_id: user.us01_user_id,
      us01_password: hashedPassword,
      us01_modified_by: String(user_id),
    });

    if (rowsUpdated === 0) {
      console.error(
        `Credentials email SENT but password NOT stored for user ${user.us01_user_id} ` +
          `(client ${client_id}). The employee has a password that does not work. Resend.`,
      );
      throw new AppError(
        "The email was sent but the password could not be saved. Please resend.",
        500,
      );
    }

    return res.status(200).json({
      success: true,
      message: `New sign-in details sent to ${user.us01_email_address}`,
    });
  } catch (error) {
    next(error);
  }
};

export const exportEnrollments = async (req, res, next) => {
  try {
    const { user_id } = req.user;
    const { from, to } = req.query;

    const { workbook } = await ExportService.buildEnrollmentReport(user_id, {
      from,
      to,
    });

    // The filename carries the period when there is one, so a folder of these
    // can be told apart without opening them. Otherwise the date it was run,
    // so two downloads in the same week do not silently overwrite each other.
    const stamp =
      from || to
        ? `${from ?? "start"}-to-${to ?? "today"}`
        : new Date().toISOString().slice(0, 10);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="enrollments-${stamp}.xlsx"`,
    );

    await workbook.xlsx.write(res);
    return res.end();
  } catch (error) {
    // Anything thrown before the first byte is written still reaches the error
    // handler as JSON. Once writing has started the response is already a
    // spreadsheet and cannot become an error object, so the only honest thing
    // left is to stop.
    if (res.headersSent) {
      console.error("Enrollment export failed mid-stream:", error);
      return res.end();
    }

    return next(error);
  }
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
