import { readFile } from "fs/promises";
import ClientModel from "../models/clientModel.js";
import BeneficiaryModel from "../models/beneficiaryModel.js";
import { renderCertificate } from "../utils/certificatePdf.js";
import { fullName } from "../utils/fullName.js";
import { AppError } from "../utils/AppError.js";
import config from "../config/env.js";
import { sendCertificateEmail } from "./emailService.js";

// Builds the Certificate of Coverage for one enrollment, from what the database
// holds — never from the request that created it. The benefit amounts are
// snapshotted by usp_ins_insurance_enrollment at enrollment and are never in a
// request body at all, and the certificate has to print what was stored.
//
// Takes the pool, like every other service since PR #102.

// usp_get_enrollment_benefits_by_id returns this for rider ALCR in place of
// its code — the procedure's own special case. It is printed alone in the
// coverage table, where every other benefit reads "description (code)".
const ADDITIONAL_LIFE = "GTLI – Additional Life";

// Static until the business says otherwise.
const PREMIUM = "—";

const hasAmount = (benefit) =>
  benefit.coverage_amount !== null && benefit.coverage_amount !== undefined;

// Whole pesos print without decimals, as in the example. Anything else prints
// two, so a split that does not land on a whole peso never reads as "18,331.5".
const money = (value) => {
  const rounded = Math.round(Number(value) * 100) / 100;
  const fraction = Number.isInteger(rounded) ? 0 : 2;

  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: fraction,
    maximumFractionDigits: fraction,
  }).format(rounded);
};

// enrollment_date is written with getdate(), which is Philippine local time,
// and mssql hands every datetime back labelled as UTC: an enrollment at 13:18
// arrives as 13:18Z. So the date is read in UTC, which returns the wall-clock
// value the database holds.
//
// Formatting it in Asia/Manila instead would add eight hours to a time that
// was already local, and every enrollment after four in the afternoon would be
// certified as covered from the following day.
export const formatCoverageDate = (value) =>
  new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));

const formatAddress = (record) =>
  [
    record.full_address,
    record.brgy_name,
    record.city_municipality_name,
    record.province_name,
    record.region_name,
    record.zip_code,
  ]
    .map((part) => (part ?? "").toString().trim())
    .filter(Boolean)
    .join(", ");

const coverageLabel = ({ benefit_name, benefit_description }) =>
  benefit_name === ADDITIONAL_LIFE || !benefit_description
    ? benefit_name
    : `${benefit_description} (${benefit_name})`;

// A formula-only benefit — the Terminal Illness Rider, "50% OF GTLIP" — prints
// its formula exactly as stored, and has no column in the dependents table.
const coverageAmount = (benefit) =>
  hasAmount(benefit) ? `P ${money(benefit.coverage_amount)}` : (benefit.coverage_formula ?? "");

// Each dependent's share of every benefit that carries an amount: the benefit
// times their coverage percent. A 100% spouse on a 500,000 plan reads 500,000,
// which is what the example shows.
const dependentAmounts = (beneficiary, amountBenefits) =>
  amountBenefits.map((benefit) =>
    money((Number(benefit.coverage_amount) * Number(beneficiary.coverage_percent)) / 100),
  );

export const buildCertificateData = async (pool, clientId) => {
  const enrollment = await ClientModel.getEnrollmentByClientId(pool, clientId);
  const record = enrollment?.[0];

  if (!record) throw new AppError("Enrollment not found", 404);

  // Both numbers reach us only through usp_get_insurance_enrollment_by_id, as
  // of DBA request 16. A certificate with a blank policy number is worse than
  // no certificate, so this refuses rather than printing one.
  if (!record.policy_no || !record.group_policy_no)
    throw new AppError(
      "The certificate cannot be issued: the enrollment has no policy number on record.",
      409,
    );

  // usp_get_enrollment_benefits_by_id filters on ec.is_active, so a
  // classification deactivated after enrollment returns nothing here. That is
  // a certificate with an empty coverage table, and it is refused for the same
  // reason as the one above.
  const benefits = await ClientModel.getEnrollmentBenefitsByClientId(pool, clientId);
  if (benefits.length === 0)
    throw new AppError(
      "The certificate cannot be issued: no active benefits were found for this enrollment.",
      409,
    );

  const beneficiaries = await BeneficiaryModel.getBeneficiariesByEnrollmentId(
    pool,
    record.enrollment_id,
  );

  const amountBenefits = benefits.filter(hasAmount);

  return {
    enrollmentId: record.enrollment_id,
    // Who the certificate goes to when HR resends it. Not printed.
    email: record.email_address,
    firstName: record.first_name,
    policyNo: record.policy_no,
    groupPolicyNo: record.group_policy_no,
    companyName: record.company_name,
    insuredName: fullName(record),
    address: formatAddress(record),
    coverageDate: formatCoverageDate(record.enrollment_date),
    premium: PREMIUM,
    coverages: benefits.map((benefit) => ({
      label: coverageLabel(benefit),
      amount: coverageAmount(benefit),
    })),
    dependentColumns: amountBenefits.map((benefit) => benefit.benefit_name),
    dependents: beneficiaries.map((beneficiary) => ({
      name: beneficiary.full_name,
      relationship: beneficiary.relationship,
      amounts: dependentAmounts(beneficiary, amountBenefits),
    })),
  };
};

// Read on every certificate rather than once at boot, so the image can be
// dropped in or replaced without a restart.
//
// Configured but unreadable is an error, not a quiet fall back to the name
// alone. Once a signature is expected, a run of certificates going out without
// it — and nothing saying so — is the silent failure worth preventing. The
// callers that must not fail still do not: tryBuildCertificate logs it and the
// email goes without the attachment.
const loadSignature = async () => {
  if (!config.certificateSignaturePath) return null;

  try {
    return await readFile(config.certificateSignaturePath);
  } catch (error) {
    throw new Error(
      `CERTIFICATE_SIGNATURE_PATH is set to "${config.certificateSignaturePath}" but it cannot be read: ${error.message}`,
    );
  }
};

// The email attachment: a name, a type, and the bytes. The filename carries the
// enrollment id, matching the example the format was copied from.
const toAttachment = async (data) => {
  const signatureImage = await loadSignature();
  const content = await renderCertificate({ ...data, signatureImage });

  return {
    name: `Certificate-of-Coverage-${data.enrollmentId}.pdf`,
    contentType: "application/pdf",
    content,
  };
};

export const buildCertificate = async (pool, clientId) =>
  toAttachment(await buildCertificateData(pool, clientId));

// HR's resend button. Unlike tryBuildCertificate below, nothing here is
// swallowed: HR asked for it and has to be told whether the employee got it.
//
// It goes to the address on the enrollment record — dbo.clients — which is the
// record the certificate describes. An approved email change writes it there
// first and syncUserRecord carries it to the user account, so the two agree in
// every case that has worked as designed.
//
// It never touches the password. The certificate is sent on its own, with its
// own subject and body, so it cannot be mistaken for new credentials.
export const resendCertificate = async (pool, clientId) => {
  const data = await buildCertificateData(pool, clientId);

  if (!data.email)
    throw new AppError(
      "This employee has no email address on file. Correct it before resending.",
      409,
    );

  const attachment = await toAttachment(data);

  try {
    await sendCertificateEmail({
      to: data.email,
      firstName: data.firstName,
      policyNo: data.policyNo,
      attachments: [attachment],
    });
  } catch (error) {
    // Caught only to say what is true. graphSendError is a plain Error, which
    // errorHandler would render as "Server Error" — and HR could not tell
    // whether the employee received it.
    console.error(`Certificate email failed for client ${clientId}. Nothing was sent.`, error);
    throw new AppError(
      "The certificate could not be emailed, so nothing was sent. Please try again.",
      502,
    );
  }

  return { to: data.email };
};

// For the senders that must go out whether or not the certificate could be
// built. The confirmation email carries the only copy of the temporary
// password, so a failure here can cost the employee their certificate and
// never their account.
//
// Resolves to the attachment, or to null with the reason in the log. It never
// rejects.
export const tryBuildCertificate = async (pool, clientId) => {
  try {
    return await buildCertificate(pool, clientId);
  } catch (error) {
    console.error(
      `Certificate of Coverage could not be built for client ${clientId}; ` +
        `the email is being sent without it.`,
      error,
    );
    return null;
  }
};

// The attachment for a decided change request, or null.
//
// An approval can change the name, the address and the beneficiaries, and all
// three are on the certificate — so the one the employee holds is out of date
// the moment it commits, and the approval email carries a fresh one. Every
// approval, not only those that touched a beneficiary: working out which
// fields a certificate depends on is a second list that would drift from the
// first.
//
// A rejection changed nothing, so it carries nothing and reads nothing.
//
// Called after the approval has committed, so the certificate describes the
// record as it now stands. Never rejects, for the same reason as below: the
// decision email is the only thing that tells the employee what HR decided.
export const certificateForDecision = async (pool, clientId, approved) =>
  approved ? tryBuildCertificate(pool, clientId) : null;

export default {
  buildCertificateData,
  buildCertificate,
  certificateForDecision,
  resendCertificate,
  tryBuildCertificate,
};
