import bcrypt from "bcrypt";
import crypto from "crypto";
import { sql } from "../config/db.js";
import config from "../config/env.js";
import EmployerAdminModel from "../models/employerAdminModel.js";
import UserModel from "../models/userModel.js";
import { sendCredentialsEmail, sendHrAccountEmail } from "./emailService.js";
import { endUserSessions } from "../realtime/realtime.js";
import { HR_ROLE_ID } from "../utils/constants.js";
import { AppError } from "../utils/AppError.js";

// A company's one HR account, created and reissued by the Administrator.
// Branch 4 of md/COMPANY-ONBOARDING-DECISIONS.md, on DBA request 24.
//
// HR signs in at the site's root, APP_URL with no path (Adrian, 2026-10-14);
// employees sign in at /employee-login. Each environment's APP_URL supplies
// the host, so nothing here names one.

// The username the design gives every HR account: hr. and the company code in
// lower case, as hr.coforge and hr.hcl already are. The code is letters,
// digits and hyphens (validateCompany), so this needs no escaping.
export const hrUsernameFor = (companyCode) => `hr.${companyCode.toLowerCase()}`;

// The same temporary password the enrollment and the employee resend issue.
const newTemporaryPassword = () => crypto.randomBytes(9).toString("base64").slice(0, 12);

const sqlNumber = (error) => error?.number ?? error?.originalError?.number;

// sec.us01_usp_ins_users answers these two for everybody, and the general map
// words 50035 for an employee id. On this path they mean something else.
const asAccountConflict = (error, username) => {
  const number = sqlNumber(error);

  if (number === 50035)
    return new AppError(`The username ${username} is already taken by another account`, 409);
  if (number === 50036)
    return new AppError("That email address already belongs to another account", 409);

  return error;
};

// Injected so the order of the writes and the email can be tested without a
// database. A fake transaction proves the order, never that SQL Server
// accepts the calls (CLAUDE.md §11); the manual run proves that.
const defaults = {
  newTransaction: (pool) => new sql.Transaction(pool),
  sendHrAccountEmail,
  sendCredentialsEmail,
  endUserSessions,
  newTemporaryPassword,
};

// Creates the account, gives it the HR role and maps it to the company, in
// one transaction. Emails the sign-in details only after the commit. If the
// email fails, the account still exists: the answer says so
// (credentials_emailed: false) and the Administrator reissues from the
// company's page. Decided 2026-10-14.
const createHrAccount = async (pool, adminId, employerId, person, deps = defaults) => {
  const company = await EmployerAdminModel.getCompanyById(pool, adminId, employerId);
  if (!company) throw new AppError("Company not found", 404);

  // The procedure refuses this too (50197). Asked first so that nothing is
  // hashed, opened or rolled back for a request that cannot succeed.
  if (company.hr_user_id) throw new AppError("This company already has an HR account", 409);

  const username = hrUsernameFor(company.company_code);
  const password = deps.newTemporaryPassword();
  const hashedPassword = await bcrypt.hash(password, 10);

  const transaction = deps.newTransaction(pool);
  await transaction.begin();

  let hrUserId;
  try {
    hrUserId = await UserModel.createUser(transaction, {
      us01_username: username,
      us01_password: hashedPassword,
      us01_first_name: person.first_name,
      us01_middle_name: person.middle_name ?? null,
      us01_last_name: person.last_name,
      us01_email_address: person.email_address,
      us01_created_by: String(adminId),
      us01_must_change_password: 1,
      client_id: null,
    });

    await UserModel.assignRole(transaction, hrUserId, {
      us02_role_id: HR_ROLE_ID,
      us04_assigned_by: String(adminId),
    });

    await EmployerAdminModel.mapHrAccount(transaction, adminId, { hrUserId, employerId });

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw asAccountConflict(error, username);
  }

  let credentialsEmailed = true;
  try {
    await deps.sendHrAccountEmail({
      to: person.email_address,
      firstName: person.first_name,
      companyName: company.company_name,
      username,
      password,
      loginUrl: config.appUrl,
    });
  } catch (error) {
    credentialsEmailed = false;
    console.error(
      `HR account ${hrUserId} (${username}) was created, but its email failed. ` +
        `Reissue from the company's page.`,
      error,
    );
  }

  return {
    user_id: hrUserId,
    username,
    email_address: person.email_address,
    credentials_emailed: credentialsEmailed,
  };
};

// A new temporary password for the company's HR account. Sends first and
// writes after, the order of adminController.resendCredentials and for its
// reason: the email is the only copy of the password, so a failed send must
// leave the old one working. Then ends the account's sessions and sockets.
const resendHrCredentials = async (pool, adminId, employerId, deps = defaults) => {
  const company = await EmployerAdminModel.getCompanyById(pool, adminId, employerId);
  if (!company) throw new AppError("Company not found", 404);

  const hr = await EmployerAdminModel.getHrAccount(pool, adminId, employerId);
  if (!hr) throw new AppError("This company has no HR account yet", 404);

  // resetPassword only touches an active account. Refused before the send, so
  // nobody is mailed a password that would never be stored.
  if (!hr.us01_is_active)
    throw new AppError("This HR account is deactivated, so no password was sent", 409);

  if (!hr.us01_email_address)
    throw new AppError("This HR account has no email address on file", 409);

  const password = deps.newTemporaryPassword();
  const hashedPassword = await bcrypt.hash(password, 10);

  try {
    await deps.sendCredentialsEmail({
      to: hr.us01_email_address,
      firstName: hr.us01_first_name,
      username: hr.us01_username,
      password,
      loginUrl: config.appUrl,
      issuedBy: "PhilLife",
      contact: "PhilLife",
    });
  } catch (error) {
    console.error(
      `Credentials email failed for HR account ${hr.us01_user_id} (company ${employerId}). ` +
        `Nothing was changed.`,
      error,
    );
    throw new AppError(
      "The email could not be sent, so nothing was changed. The HR account's current password still works. Please try again.",
      502,
    );
  }

  const rowsUpdated = await UserModel.resetPassword(pool, {
    us01_user_id: hr.us01_user_id,
    us01_password: hashedPassword,
    us01_modified_by: String(adminId),
  });

  if (rowsUpdated === 0) {
    console.error(
      `Credentials email SENT but password NOT stored for HR account ${hr.us01_user_id} ` +
        `(company ${employerId}). It has a password that does not work. Resend.`,
    );
    throw new AppError("The email was sent but the password could not be saved. Please resend.", 500);
  }

  // resetPassword raised the token version, which ends the sessions at
  // verifySession. This closes the open sockets too.
  deps.endUserSessions(hr.us01_user_id);

  return { email_address: hr.us01_email_address };
};

export default {
  createHrAccount,
  resendHrCredentials,
};
