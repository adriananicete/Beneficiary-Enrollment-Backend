import { escapeHtml } from "./escapeHtml.js";
import {
  emailButton,
  emailCallout,
  emailLayout,
  emailNote,
} from "./emailLayout.js";

// Sent when HR reissues an employee's credentials. Deliberately not the
// enrollment confirmation template — that one opens with "Your account has been
// created" and carries a policy number, neither of which is true here. The
// account already exists and the old password has just stopped working, which is
// the thing the reader most needs told.
export const credentialsEmailTemplate = ({
  firstName,
  username,
  password,
  loginUrl,
}) => {
  return emailLayout({
    title: "Your new sign-in details",
    heading: "Your new sign-in details",
    body: `
                <p style="margin: 0 0 14px 0">Hi ${escapeHtml(firstName)},</p>

                <p style="margin: 0 0 14px 0">
                  Your HR has issued you a new temporary password. Any password
                  you used before this email no longer works.
                </p>
${emailCallout(`
                      Username: <strong>${escapeHtml(username)}</strong><br />
                      Password: <strong>${escapeHtml(password)}</strong>`)}
${emailButton({ href: loginUrl, label: "Sign in" })}
${emailNote(`
                  You'll be asked to choose your own password as soon as you
                  sign in. If you didn't ask for this, contact your HR straight
                  away &mdash; someone requested it on your behalf.`)}`,
  });
};
