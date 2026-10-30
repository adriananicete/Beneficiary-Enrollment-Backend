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
import { ageAtLastBirthday } from "../utils/validateBirthdate.js";
import crypto from "crypto";
import config from "../config/env.js";

// The invitation behind a public link, refused the way GET /enrollment/invitation
// refuses it: not found, expired, or already used. Shared by the submit and by
// the classification list, so the form cannot list a company's classes for a
// link it would refuse to submit.
const openInvitation = async (pool, token) => {
  const invitation = await InvitationModel.getInvitationByToken(pool, token)
  if(!invitation) throw new AppError("Invitation not found", 404);

  if(!invitation.is_valid) throw new AppError("This invitation has expired. Please ask your HR to resend it.", 410);
  if(invitation.is_enrolled) throw new AppError("You have already submitted an enrollment", 409);

  return invitation;
};

// The class and the affiliate the employee is enrolled under. HR assigns both
// on the invitation (branch 6 of the onboarding effort), so the form's values
// are ignored, not compared, the same rule as the company and the email.
//
// An invitation sent before branch 6 has no class: the employee chooses one,
// from their company's active list (branch 1). Its affiliate is NULL, the
// company itself.
//
// `activeClasses` is the invitation's company's active list. One sentence for
// a body class that does not exist, is retired, or is another company's: the
// employee fixes all three the same way. An assigned class that has been
// retired since is HR's to fix (Adrian, 2026-10-15).
export const assignedClassAndAffiliate = (invitation, body, activeClasses) => {
  const active = new Set(activeClasses.map((c) => String(c.classification_id)));
  const affiliate_id = invitation.affiliate_id ?? null;

  if (invitation.classification_id != null) {
    if (!active.has(String(invitation.classification_id)))
      throw new AppError("Your classification is no longer available. Please contact your HR.", 409);

    return { classification_id: invitation.classification_id, affiliate_id };
  }

  if (!body.classification_id)
    throw new AppError("classification_id is required", 400);

  // usp_ins_insurance_enrollment refuses another company's class as well
  // (50180, DBA request 23), so this is not the only guard.
  if (!active.has(String(body.classification_id)))
    throw new AppError("That classification is not available for your company", 400);

  return { classification_id: body.classification_id, affiliate_id };
};

// Takes the pool, like every other service since PR #102. The controller
// fetches it; this decides.
//
// Everything down to `new sql.Transaction(pool)` is a refusal, and every one of
// them is tested. The transaction body is not, deliberately — its correctness
// is about whether the database agrees with us on insert order and procedure
// contracts, and a fake transaction would agree with whatever we told it. Two
// defects on 2026-09-08 were exactly that failure. The rollback itself was
// proven end to end on 2026-09-04, when a duplicate beneficiary name answered
// 409 and left nothing behind.
const createEnrollment = async (pool, enrollmentData) => {
  const invitation = await openInvitation(pool, enrollmentData.token);

  enrollmentData.employer_id = invitation.employer_id;
  enrollmentData.email_address = invitation.email_address;

  // The company's limit on online enrollment, employers.online_enrollment_max_age
  // (DBA request 23): the oldest age, at last birthday, that may enroll here.
  // NULL means no limit beyond validateBirthdate's 18–100. ABCC's is 65 until
  // its age rules are built (branch 9): a full amount the contract would not
  // pay must not be snapshotted. The limit itself never leaves the backend;
  // the public invitation lookup answers field by field (branch 0).
  const maxAge = invitation.online_enrollment_max_age;
  if (maxAge !== null && maxAge !== undefined && ageAtLastBirthday(enrollmentData.birthdate) > maxAge)
    throw new AppError("Your enrollment cannot be completed online. Please contact your HR.", 409);

  const employers = await ReferenceModel.getEmployers(pool);

  const employerSet = new Set(employers.map((r) => String(r.employer_id)));
  if (!employerSet.has(String(enrollmentData.employer_id)))
    throw new AppError("Invalid or inactive employer", 400);

  // The invitation's company's classes, never the form's company.
  const classifications = await ReferenceModel.getClassificationsByEmployer(
    pool,
    invitation.employer_id,
  );

  // Overwritten whatever the form sent, the affiliate included even when it is
  // null: every model below reads both from enrollmentData.
  const { classification_id, affiliate_id } = assignedClassAndAffiliate(
    invitation,
    enrollmentData,
    classifications,
  );
  enrollmentData.classification_id = classification_id;
  enrollmentData.affiliate_id = affiliate_id;

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
  openInvitation,
  createEnrollment,
  getFullEnrollmentDetails,
};
