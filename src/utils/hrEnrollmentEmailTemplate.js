import { escapeHtml } from "./escapeHtml.js";
import {
  emailButton,
  emailCallout,
  emailLayout,
  emailNote,
} from "./emailLayout.js";

// The enrollment confirmation for an HR person who enrolled themselves. Not the employee's confirmation (emailTemplate):
// that one is the only copy of a temporary password and says an account was created, and here there is neither. The
// HR account is the account, and the login is the same HR login: they sign in at the HR page and open My Enrollment.
// It carries the username only, never a password, because the person already has one.
//
// The certificate is attached, and the email says so, only when the company allows it to be sent (the caller passes it
// then). `loginUrl` is the HR sign-in page.
//
// `username` is the HR account's, which this system made (hr.<code>), but it is escaped like every other value.
export const hrEnrollmentEmailTemplate = ({
  policyNo,
  username,
  firstName,
  loginUrl,
  certificateAttached = false,
}) => {
  // Said only when the certificate is really attached: it is built separately and can fail while this email goes out
  // regardless, the same rule as the employee's confirmation.
  const certificateLine = certificateAttached
    ? `
                <p style="margin: 0 0 14px 0">
                  Your Certificate of Coverage is attached to this email as a
                  PDF.
                </p>`
    : "";

  return emailLayout({
    title: "Your enrollment is complete",
    heading: "Your enrollment is complete",
    body: `
                <p style="margin: 0 0 14px 0">Hi ${escapeHtml(firstName)},</p>

                <p style="margin: 0 0 14px 0">
                  Your enrollment has been received and your policy number is
                  <strong>${escapeHtml(policyNo)}</strong>.
                </p>
${certificateLine}
                <p style="margin: 0 0 14px 0">
                  You already have an HR account, so no new account was
                  created. Your login is the same: sign in with the username
                  and password you use as HR, then open
                  <strong>My Enrollment</strong> to see your enrollment.
                </p>
${emailCallout(`
                      Username: <strong>${escapeHtml(username)}</strong>`)}
${emailButton({ href: loginUrl, label: "Sign in" })}
${emailNote(`
                  Your password has not changed. Please don't reply to this
                  email &mdash; nobody reads this address.`)}`,
  });
};
