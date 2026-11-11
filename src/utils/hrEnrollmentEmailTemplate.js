import { escapeHtml } from "./escapeHtml.js";
import { emailButton, emailCallout, emailLayout, emailNote } from "./emailLayout.js";

// The enrollment confirmation for an HR person who enrolled themselves (DBA
// request 31), ported from the teammates. Not the employee's confirmation
// (emailTemplate): that one carries the only copy of a temporary password and
// says an account was made, and here there is neither. The HR account is the
// account, and the login is the HR login they already use.
//
// The username only, never a password. Escaped like every other value, though
// this system made it (hr.<code>).
//
// The certificate is said to be attached only when it really is: it is built
// separately and can fail while this email still goes out, the same rule as the
// employee's confirmation.
export const hrEnrollmentEmailTemplate = ({ policyNo, username, firstName, loginUrl, certificateAttached = false }) => {
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
                  created. Sign in with the username and password you use as
                  HR to see your enrollment.
                </p>
${emailCallout(`
                      Username: <strong>${escapeHtml(username)}</strong>`)}
${emailButton({ href: loginUrl, label: "Sign in" })}
${emailNote(`
                  Your password has not changed. Please don't reply to this
                  email &mdash; nobody reads this address.`)}`,
  });
};

export default { hrEnrollmentEmailTemplate };
