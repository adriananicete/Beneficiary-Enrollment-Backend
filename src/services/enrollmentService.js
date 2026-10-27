import { sql } from "../config/db.js";
import ClientModel from "../models/clientModel.js";
import AddressModel from "../models/addressModel.js";
import EmployerModel from "../models/employerModel.js";
import ApplicationModel from "../models/applicationModel.js";
import BeneficiaryModel from "../models/beneficiaryModel.js";
import AgreementModel from "../models/agreementModel.js";
import UserModel from "../models/userModel.js";
import ReferenceModel from "../models/referenceModel.js";
import InvitationModel from "../models/invitationModel.js";
import SignatureModel from "../models/signatureModel.js";
import bcrypt from "bcrypt";
import { EMPLOYEE_ROLE_ID } from "../utils/constants.js";
import { sendConfirmationEmail } from "./emailService.js";
import { autoCertificateFor } from "./certificateService.js";
import { AppError } from "../utils/AppError.js";
import crypto from "crypto";
import config from "../config/env.js";

const createEnrollment = async (pool, enrollmentData) => {
  const invitation = await InvitationModel.getInvitationByToken(pool, enrollmentData.token)
  if(!invitation) throw new AppError("Invitation not found", 404);

  if(!invitation.is_valid) throw new AppError("This invitation has expired. Please ask your HR to resend it.", 410);
  if(invitation.is_enrolled) throw new AppError("You have already submitted an enrollment", 409);

  enrollmentData.employer_id = invitation.employer_id;
  enrollmentData.email_address = invitation.email_address;

  const employers = await ReferenceModel.getEmployers(pool);

  const employerSet = new Set(employers.map((r) => String(r.employer_id)));
  if (!employerSet.has(String(enrollmentData.employer_id)))
    throw new AppError("Invalid or inactive employer", 400);

  // const classification = await ReferenceModel.getEmployeeClassifications(pool);

    const classification =
      await ReferenceModel.getEmployeeClassifications(
        pool,
        enrollmentData.employer_id,
    );

  const classificationSet = new Set(
    classification.map((c) => String(c.classification_id)),
  );
  if (!classificationSet.has(String(enrollmentData.classification_id)))
    throw new AppError("The selected classification is not available for your employer", 400);

  const barangayIsReal = await ReferenceModel.barangayExists(
    pool,
    enrollmentData.barangay_id,
  );
  if (!barangayIsReal)
    throw new AppError("Invalid barangay", 400);

  const userNameExists = await UserModel.checkUsernameExists(
    pool,
    enrollmentData.employee_id_number,
  );
  if (userNameExists)
    throw new AppError("Employee ID number already exists", 409);

  const transaction = new sql.Transaction(pool);
  let rolledBack = false;
  let committed = false;
  transaction.on("rollback", () => { rolledBack = true; });
  await transaction.begin();

  try {
    const clientId = await ClientModel.insertClient(transaction, {
      ...enrollmentData,
      created_by: "system",
    });

    if (enrollmentData.signature) {
      await SignatureModel.insertSignature(transaction, {
        client_id: clientId,
        content: enrollmentData.signature.content,
        mime_type: enrollmentData.signature.mimeType,
        byte_size: enrollmentData.signature.byteSize,
        sha256: enrollmentData.signature.sha256,
        source: enrollmentData.signature.source,
        created_by: "system",
      });
    }

    const clientAddressId = await AddressModel.insertClientAddress(
      transaction,
      clientId,
      { ...enrollmentData, created_by: "system" },
    );

    const clientEmployerId = await EmployerModel.insertClientEmployer(
      transaction,
      { ...enrollmentData, client_id: clientId, is_current: true },
    );

    const { enrollmentId, policyNo } = await ApplicationModel.insertApplication(
      transaction,
      {
        ...enrollmentData,
        client_id: clientId,
        client_employer_id: clientEmployerId,
        created_by: "system",
      },
    );

    for (let beneficiary of enrollmentData.beneficiaries) {
      await BeneficiaryModel.insertBeneficiary(transaction, {
        ...beneficiary,
        enrollment_id: enrollmentId,
        created_by: "system",
      });
    }

    await AgreementModel.insertAgreements(transaction, clientId, {
      ...enrollmentData,
      agreement_type: "privacy",
      agreement_version: 1.0,
      accepted: enrollmentData.consent_privacy,
      created_by: "system",
    });

    await AgreementModel.insertAgreements(transaction, clientId, {
      ...enrollmentData,
      agreement_type: "term",
      agreement_version: 1.0,
      accepted: enrollmentData.consent_terms,
      created_by: "system",
    });

    const tempPassword = crypto.randomBytes(9).toString("base64").slice(0, 12);
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    const userId = await UserModel.createUser(transaction, {
      us01_username: enrollmentData.employee_id_number,
      us01_password: hashedPassword,
      us01_first_name: enrollmentData.first_name,
      us01_middle_name: enrollmentData.middle_name,
      us01_last_name: enrollmentData.last_name,
      us01_must_change_password: 1,
      us01_email_address: enrollmentData.email_address,
      client_id: clientId,
      us01_created_by: "system",
    });

    await UserModel.assignRole(transaction, userId, {
      us02_role_id: EMPLOYEE_ROLE_ID,
      us04_assigned_by: "system",
    });

    await transaction.commit();
    committed = true;

    // Built after the commit and read back from the database, so it certifies
    // what was stored. autoCertificateFor never rejects: a certificate that
    // cannot be built costs the employee the attachment, never the email with
    // their temporary password in it. It is null, and nothing is built, when
    // the company has turned the automatic certificate off (DBA request 19).
    const certificate = await autoCertificateFor(pool, clientId);

    try {
      await sendConfirmationEmail({
        to: enrollmentData.email_address,
        policyNo: policyNo,
        firstName: enrollmentData.first_name,
        username: enrollmentData.employee_id_number,
        password: tempPassword,
        loginUrl: `${config.appUrl}/employee-login`,
        attachments: certificate ? [certificate] : [],
      });
    } catch (error) {
      console.error("Confirmation email failed:", {
        client_id: clientId,
        email: enrollmentData.email_address,
        error,
      });
    }

    return { clientId, enrollmentId, policyNo };
  } catch (error) {
    if (!committed && !rolledBack) {
      try {
        await transaction.rollback();
      } catch (rollbackError) {
        console.error("Enrollment rollback failed:", rollbackError);
      }
    }
    console.error("Service Error:", error);
    throw error;
  }
};

const getFullEnrollmentDetails = async (pool, clientId) => {
  const enrollmentDetails = await ClientModel.getEnrollmentByClientId(
    pool,
    clientId,
  );

  if (!enrollmentDetails || enrollmentDetails.length === 0)
    throw new AppError("Enrollment not found", 404);

  const enrollmentBenefitsById =
    await ClientModel.getEnrollmentBenefitsByClientId(pool, clientId);

  const beneficiaries = await BeneficiaryModel.getBeneficiariesByEnrollmentId(
    pool, enrollmentDetails[0].enrollment_id,
  );

  return {
    enrollment: enrollmentDetails,
    benefits: enrollmentBenefitsById,
    beneficiaries,
  };
};

export default {
  createEnrollment,
  getFullEnrollmentDetails,
};
