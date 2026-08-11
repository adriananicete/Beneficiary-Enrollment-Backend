import { poolPromise, sql } from "../config/db.js";
import ClientModel from "../models/clientModel.js";
import AddressModel from "../models/addressModel.js";
import EmployerModel from "../models/employerModel.js";
import ApplicationModel from "../models/applicationModel.js";
import BeneficiaryModel from "../models/beneficiaryModel.js";
import AgreementModel from "../models/agreementModel.js";
import UserModel from "../models/userModel.js";
import ReferenceModel from "../models/referenceModel.js";
import bcrypt from "bcrypt";
import { EMPLOYEE_ROLE_ID } from "../utils/constants.js";
import { sendConfirmationEmail } from "./emailService.js";
import { AppError } from "../utils/AppError.js";
import crypto from "crypto";
import { validateCoverage } from "../utils/validateCoverage.js";
import config from "../config/env.js";

const createEnrollment = async (enrollmentData) => {
  const pool = await poolPromise;

  const employers = await ReferenceModel.getEmployers(pool);

  const employerSet = new Set(employers.map((r) => String(r.employer_id)));
  if (!employerSet.has(String(enrollmentData.employer_id)))
    throw new AppError("Invalid or inactive employer", 400);

  const classification = await ReferenceModel.getEmployeeClassifications(pool);

  const classificationSet = new Set(
    classification.map((c) => String(c.classification_id)),
  );
  if (!classificationSet.has(String(enrollmentData.classification_id)))
    throw new AppError("Invalid or inactive classification", 400);

  const userNameExists = await UserModel.checkUsernameExists(
    pool,
    enrollmentData.employee_id_number,
  );
  if (userNameExists)
    throw new AppError("Employee ID number already exists", 409);

  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    const clientId = await ClientModel.insertClient(transaction, {
      ...enrollmentData,
      created_by: "system",
    });

    const clientAddressId = await AddressModel.insertClientAddress(
      transaction,
      clientId,
      { ...enrollmentData, created_by: "system" },
    );

    const clientEmployerId = await EmployerModel.insertClientEmployer(
      transaction,
      { ...enrollmentData, client_id: clientId, is_current: true },
    );

    const { enrollmentId, policyNo } = await ApplicationModel.insertApplication(transaction, {
      ...enrollmentData,
      client_id: clientId,
      client_employer_id: clientEmployerId,
      created_by: "system",
    });

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

    try {
      await sendConfirmationEmail({
        to: enrollmentData.email_address,
        policyNo: policyNo,
        firstName: enrollmentData.first_name,
        lastName: enrollmentData.last_name,
        username: enrollmentData.employee_id_number,
        password: tempPassword,
        loginUrl: `${config.appUrl}/login`,
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
    await transaction.rollback();
    console.error("Service Error:", error);
    throw error;
  }
};

const updateEnrollment = async (userId, enrollmentData) => {
  const pool = await poolPromise;

  const ownershipRows = await ClientModel.getOwnershipIds(
    pool,
    enrollmentData.client_id,
  );
  if (ownershipRows.length === 0)
    throw new AppError("No enrollment found for this client", 404);

  const validAddressIds = new Set(
    ownershipRows.map((r) => String(r.client_address_id)),
  );

  if (enrollmentData.client_address_id) {
    if (!validAddressIds.has(String(enrollmentData.client_address_id)))
      throw new AppError("Address does not belong to this enrollment", 403);
  }

  if (enrollmentData.beneficiaries !== undefined) {
    const coverageError = validateCoverage(enrollmentData.beneficiaries);
    if (coverageError) throw new AppError(coverageError, 400);

    const validBeneficiariesIds = new Set(
      ownershipRows
        .filter((r) => r.beneficiary_id !== null)
        .map((r) => String(r.beneficiary_id)),
    );

    for (let beneficiary of enrollmentData.beneficiaries) {
      if (!validBeneficiariesIds.has(String(beneficiary.beneficiary_id)))
        throw new AppError(
          "Beneficiary does not belong to this enrollment",
          403,
        );
    }

    const submittedIds = new Set(
      enrollmentData.beneficiaries.map((b) => String(b.beneficiary_id)),
    );

    if (submittedIds.size !== enrollmentData.beneficiaries.length)
      throw new AppError(
        "Duplicate beneficiary is not allowed in the same update.",
        400,
      );

    if (submittedIds.size !== validBeneficiariesIds.size)
      throw new AppError(
        "The update must include all existing beneficiaries.",
        400,
      );
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    await ClientModel.updateClient(transaction, {
      ...enrollmentData,
      modified_by: userId,
    });

    if (enrollmentData.client_address_id) {
      await AddressModel.updateClientAddress(transaction, {
        ...enrollmentData,
        modified_by: userId,
      });
    }

    if (
      Array.isArray(enrollmentData.beneficiaries) &&
      enrollmentData.beneficiaries.length > 0
    ) {
      for (let beneficiary of enrollmentData.beneficiaries) {
        await BeneficiaryModel.updateBeneficiary(transaction, {
          ...beneficiary,
          modified_by: userId,
        });
      }
    }

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
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

  return {
    enrollment: enrollmentDetails,
    benefits: enrollmentBenefitsById,
  };
};

export default {
  createEnrollment,
  getFullEnrollmentDetails,
  updateEnrollment,
};
