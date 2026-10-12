// Sent to the employee when HR approves, rejects or returns their claim. The
// wording was agreed with Adrian on 2026-10-12.
//
// The employee's name and the claim type come from the database and are
// escaped like everything else that crosses into HTML. HR's remarks are
// escaped by emailRemarks.
import { escapeHtml } from "./escapeHtml.js";
import { emailButton, emailLayout, emailNote, emailRemarks } from "./emailLayout.js";

const HEADINGS = {
  APPROVED: "Your claim was approved",
  REJECTED: "Your claim was not approved",
  RETURNED: "Your claim needs more documents",
};

const ACCENTS = {
  APPROVED: "#409965",
  REJECTED: "#b3541e",
  RETURNED: "#b3541e",
};

export const claimDecisionEmailTemplate = ({
  employeeName,
  claimType,
  status,
  reviewRemarks,
  accountClosed = false,
  loginUrl,
}) => {
  const heading = HEADINGS[status];
  const type = escapeHtml(claimType);

  const leads = {
    APPROVED: `Your HR has approved your ${type} claim.`,
    REJECTED: `Your HR has reviewed your ${type} claim and has not approved it.`,
    RETURNED: `Your HR needs more documents for your ${type} claim. Sign in, add what the note below asks for, and resubmit.`,
  };

  // Only when the approval really closed the account. The procedure reports
  // it, so the email never says so on a guess.
  const closedLine =
    status === "APPROVED" && accountClosed
      ? `
                <p style="margin: 0 0 14px 0">
                  Because this claim ends your coverage, your account on this
                  system has been closed. Please keep this email for your
                  records.
                </p>`
      : "";

  // No button to an account that is closed: it would only lead to a refusal.
  const button = accountClosed ? "" : emailButton({ href: loginUrl, label: "Sign in" });

  return emailLayout({
    title: heading,
    heading,
    body: `
                <p style="margin: 0 0 14px 0">Hi ${escapeHtml(employeeName)},</p>

                <p style="margin: 0 0 14px 0">${leads[status]}</p>
${closedLine}
${emailRemarks({ remarks: reviewRemarks, accent: ACCENTS[status] })}
${button}
${emailNote(`
                  You are receiving this because you filed a claim. If that
                  wasn't you, please contact your HR.`)}`,
  });
};

export default { claimDecisionEmailTemplate };
