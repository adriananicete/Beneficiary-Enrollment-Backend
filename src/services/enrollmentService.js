import { poolPromise, sql } from "../config/db.js";
import ClientModel from "../models/clientModel.js";
import AddressModel from "../models/addressModel.js";
import EmployerModel from "../models/employerModel.js";
import ApplicationModel from "../models/applicationModel.js";
import BeneficiaryModel from "../models/beneficiaryModel.js";
import AgreementModel from "../models/agreementModel.js";
import UserModel from "../models/userModel.js";
import bcrypt, { hash } from "bcrypt";
import { EMPLOYEE_ROLE_ID } from "../utils/constants.js";
import { sendConfirmationEmail } from "./emailService.js";

const createEnrollment = async (enrollmentData) => {
  const pool = await poolPromise;
  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    
    const clientId = await ClientModel.insertClient(
      transaction,
      {...enrollmentData, created_by: 'system'},
    );

    const clientAddressId = await AddressModel.insertClientAddress(
      transaction,
      clientId,
      enrollmentData,
    );

    const clientEmployerId = await EmployerModel.insertClientEmployer(
      transaction,
      { ...enrollmentData, client_id: clientId, is_current: true },
    );

    const enrollmentId = await ApplicationModel.insertApplication(
      transaction,
      {
        ...enrollmentData,
        client_id: clientId,
        client_employer_id: clientEmployerId,
        created_by: 'system',
      },
    );

    for (let beneficiary of enrollmentData.beneficiaries) {
      await BeneficiaryModel.insertBeneficiary(transaction, {
        ...beneficiary,
        enrollment_id: enrollmentId,
        created_by: 'system',
      });
    }

    await AgreementModel.insertAgreements(transaction, clientId, {
      ...enrollmentData,
      agreement_type: "privacy",
      agreement_version: 1.0,
      accepted: enrollmentData.consent_privacy,
      created_by: 'system',
    });

    await AgreementModel.insertAgreements(transaction, clientId, {
      ...enrollmentData,
      agreement_type: "term",
      agreement_version: 1.0,
      accepted: enrollmentData.consent_terms,
      created_by: 'system',
    });

    const birthdate = new Date(enrollmentData.birthdate);
    const mm = String(birthdate.getMonth() + 1).padStart(2, "0");
    const dd = String(birthdate.getDate()).padStart(2, "0");
    const yyyy = birthdate.getFullYear();
    const tempPassword = `${mm}${dd}${yyyy}`;
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    const userId = await UserModel.createUser(transaction, {
      us01_username: enrollmentData.employee_id_number,
      us01_password: hashedPassword,
      us01_firstname: enrollmentData.first_name,
      us01_middle_name: enrollmentData.middle_name,
      us01_last_name: enrollmentData.last_name,
      us01_email_address: enrollmentData.email_address,
      us01_created_by: 'system',
    });

    await UserModel.assignRole(transaction, userId, {
      us02_role_id: EMPLOYEE_ROLE_ID,
      us04_assigned_by: 'system'
    });

    await transaction.commit();

    try {
      await sendConfirmationEmail({to: enrollmentData.email_address, referenceNumber: enrollmentId, username: enrollmentData.employee_id_number, password: tempPassword, loginUrl: '/api/employee/login'});
    } catch (error) {
      console.log(error)
    }

    return { clientId, enrollmentId };
  } catch (error) {
    await transaction.rollback();
    console.error('Service Error:', error)
    throw error;
  }
};

export default {
  createEnrollment,
};
