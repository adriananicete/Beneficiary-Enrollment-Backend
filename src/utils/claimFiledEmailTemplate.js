// Sent to the employee when HR or the Administrator files a claim in their
// name (DBA request 36, decided 2026-11-12). The claim is theirs: they can see
// it and cancel it, and they are told the decision as with any claim.
//
// The employee's name and the claim type come from the database and are
// escaped like everything else that crosses into HTML.
import { escapeHtml } from "./escapeHtml.js";
import { emailButton, emailLayout, emailNote } from "./emailLayout.js";

export const CLAIM_FILED_SUBJECT = "A claim was filed for you";

export const claimFiledEmailTemplate = ({ employeeName, claimType, loginUrl }) =>
  emailLayout({
    title: CLAIM_FILED_SUBJECT,
    heading: CLAIM_FILED_SUBJECT,
    body: `
                <p style="margin: 0 0 14px 0">Hi ${escapeHtml(employeeName)},</p>

                <p style="margin: 0 0 14px 0">
                  Your HR has filed a ${escapeHtml(claimType)} claim for you. It
                  will be reviewed, and you will receive an email with the
                  decision.
                </p>

                <p style="margin: 0 0 14px 0">
                  You can see it when you sign in, and cancel it there if you
                  did not ask for it.
                </p>
${emailButton({ href: loginUrl, label: "Sign in" })}
${emailNote(`
                  You are receiving this because a claim was filed in your
                  name. If you did not ask for it, please contact your HR.`)}`,
  });

export default { CLAIM_FILED_SUBJECT, claimFiledEmailTemplate };
