import { escapeHtml } from "./escapeHtml.js";
import {
  emailButton,
  emailCallout,
  emailLayout,
  emailNote,
} from "./emailLayout.js";

// The enrollment confirmation — the first email an employee ever receives from
// this system, and the only copy of their temporary password.
//
// Rebuilt on the shared layout 2026-09-14. It was the one template not in the
// house style: a gradient header bar instead of the logo, a card with a drop
// shadow, a footer, and **no logo at all** — the only one of the five without
// one. Nothing suggests that was a decision; it predates the other four.
//
// `username` is the employee id straight off the enrollment form. It is
// required and capped at 50 characters and its shape is not validated, so it
// can carry markup. It goes only to the person who typed it, which is why
// escaping it is consistency rather than a fix — but the same two values are
// escaped in credentialsEmailTemplate, and one of the two had to be wrong.
export const emailTemplate = ({
  policyNo,
  username,
  firstName,
  password,
  loginUrl,
  certificateAttached = false,
}) => {
  // Said only when the certificate is really attached, the same rule as the
  // change request decision email. It is built separately and can fail while
  // this email goes out regardless, so a line promising an attachment that is
  // not there would send the employee looking for a file nobody sent.
  const certificateLine = certificateAttached
    ? `
                <p style="margin: 0 0 14px 0">
                  Your Certificate of Coverage is attached to this email as a
                  PDF.
                </p>`
    : "";

  return emailLayout({
    title: "Your enrollment is complete",
    heading: "Your account has been created",
    body: `
                <p style="margin: 0 0 14px 0">Hi ${escapeHtml(firstName)},</p>

                <p style="margin: 0 0 14px 0">
                  Your enrollment has been received and your policy number is
                  <strong>${escapeHtml(policyNo)}</strong>.
                </p>
${certificateLine}
                <p style="margin: 0 0 14px 0">
                  These are your temporary sign-in details:
                </p>
${emailCallout(`
                      Username: <strong>${escapeHtml(username)}</strong><br />
                      Password: <strong>${escapeHtml(password)}</strong>`)}
${emailButton({ href: loginUrl, label: "Sign in" })}
${emailNote(`
                  You'll be asked to choose your own password as soon as you
                  sign in, so this temporary one stops working after that.
                  Please don't reply to this email &mdash; nobody reads this
                  address.`)}`,
  });
};
