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

// A company's HR accounts, created and reissued by the Administrator.
// Branch 4 of md/COMPANY-ONBOARDING-DECISIONS.md, on DBA request 24.
//
// Several per company since 2026-11-11 (Adrian), ported from the teammates'
// 9d967ec. The database allowed it from the DBA change of 2026-11-06, which
// commented out the "one HR account" check (50197). No limit on how many.
//
// HR signs in at the site's root, APP_URL with no path (Adrian, 2026-10-14);
// employees sign in at /employee-login. Each environment's APP_URL supplies
// the host, so nothing here names one.

// The usernames the design gives HR accounts: hr. and the company code in
// lower case for the first, as hr.coforge and hr.hcl already are, then
// hr.<code>.2, hr.<code>.3 and so on. The code is letters, digits and hyphens
// (validateCompany): no dot, so a numbered name can never be another
// company's, and nothing needs escaping.
export const hrUsernameFor = (companyCode, n = 1) => {
  const base = `hr.${companyCode.toLowerCase()}`;

  return n === 1 ? base : `${base}.${n}`;
};

// The first of those no account holds, counted against every username, active
// or not, mapped or not (sec.usp_sel_username_exists). Not from the company's
// listed HR accounts, as the teammates' version did: that list leaves out an
// account whose role or mapping is inactive, which still holds its name, so it
// offered hr.abc.2 again and the Administrator met 409 on every try.
//
// Bounded so a fault cannot loop for ever. A thousand is far past any company.
export const MAX_HR_USERNAME_TRIES = 1000;

export const nextHrUsername = async (pool, companyCode) => {
  for (let n = 1; n <= MAX_HR_USERNAME_TRIES; n += 1) {
    const username = hrUsernameFor(companyCode, n);

    if (!(await UserModel.checkUsernameExists(pool, username))) return username;
  }

  throw new AppError("No HR username is free for this company", 409);
};

// One HR account as the company page and the answers show it. Named field by
// field; the procedure returns no password column, and one it gains later
// stays out until somebody adds it here.
export const hrAccountOf = (row) => ({
  user_id: row.us01_user_id,
  username: row.us01_username,
  first_name: row.us01_first_name,
  middle_name: row.us01_middle_name,
  last_name: row.us01_last_name,
  email_address: row.us01_email_address,
  is_active: row.us01_is_active,
  is_locked: row.us01_is_locked,
  must_change_password: row.us01_must_change_password,
});

// The same temporary password the enrollment and the employee resend issue.
const newTemporaryPassword = () => crypto.randomBytes(9).toString("base64").slice(0, 12);

const sqlNumber = (error) => error?.number ?? error?.originalError?.number;

// sec.us01_usp_ins_users answers these two for everybody, and the general map
// words 50035 for an employee id. On this path they mean something else.
// 50035 here is two Administrators adding an account to the same company at
// once: both were offered the same free name, and the second insert lost.
const asAccountConflict = (error, username) => {
  const number = sqlNumber(error);

  if (number === 50035)
    return new AppError(`The username ${username} was just taken by another account. Please try again.`, 409);
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

  // A company may have several (2026-11-11), so a company that has one is no
  // longer refused. The account gets the next free name.
  const username = await nextHrUsername(pool, company.company_code);
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

// Which of the company's HR accounts a reissue is for.
//
// Named (hrUserId, the route with :user_id): that account, if it is one of
// this company's; another company's or an unknown id is 404, as if it did not
// exist.
//
// Not named (the route from before 2026-11-11, kept working, Adrian): the
// company's one account. With several there is no right guess, so it is 409
// and the screen asks which.
const pickHrAccount = (accounts, hrUserId) => {
  if (hrUserId !== undefined && hrUserId !== null) {
    const named = accounts.find((account) => String(account.us01_user_id) === String(hrUserId));
    if (!named) throw new AppError("HR account not found for this company", 404);

    return named;
  }

  if (accounts.length === 0) throw new AppError("This company has no HR account yet", 404);

  if (accounts.length > 1)
    throw new AppError("This company has several HR accounts. Choose which one to send a new password to.", 409);

  return accounts[0];
};

// A new temporary password for one of the company's HR accounts. Sends first
// and writes after, the order of adminController.resendCredentials and for its
// reason: the email is the only copy of the password, so a failed send must
// leave the old one working. Then ends the account's sessions and sockets.
const resendHrCredentials = async (pool, adminId, employerId, hrUserId = null, deps = defaults) => {
  const company = await EmployerAdminModel.getCompanyById(pool, adminId, employerId);
  if (!company) throw new AppError("Company not found", 404);

  const accounts = await EmployerAdminModel.getHrAccounts(pool, adminId, employerId);
  const hr = pickHrAccount(accounts, hrUserId);

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

  // The account's id and username are for the security event the controller
  // records; only the address is shown to the caller.
  return { email_address: hr.us01_email_address, user_id: hr.us01_user_id, username: hr.us01_username };
};

// Every HR account of the company, for its page.
const getHrAccounts = async (pool, adminId, employerId) =>
  (await EmployerAdminModel.getHrAccounts(pool, adminId, employerId)).map(hrAccountOf);

export default {
  createHrAccount,
  resendHrCredentials,
  getHrAccounts,
  nextHrUsername,
};
