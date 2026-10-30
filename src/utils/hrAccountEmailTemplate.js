import { escapeHtml } from "./escapeHtml.js";
import {
  emailButton,
  emailCallout,
  emailLayout,
  emailNote,
} from "./emailLayout.js";

// Sent once, when the Administrator creates a company's HR account (branch 4
// of the onboarding effort). Not the credentials template: that one says a
// password was reissued and the old one has stopped working, and here there
// was no old one.
export const hrAccountEmailTemplate = ({
  firstName,
  companyName,
  username,
  password,
  loginUrl,
}) => {
  return emailLayout({
    title: "Your HR account",
    heading: "Your HR account is ready",
    body: `
                <p style="margin: 0 0 14px 0">Hi ${escapeHtml(firstName)},</p>

                <p style="margin: 0 0 14px 0">
                  PhilLife has created the HR account for
                  <strong>${escapeHtml(companyName)}</strong>. You will use it to
                  invite your employees to enroll and to review their requests.
                </p>
${emailCallout(`
                      Username: <strong>${escapeHtml(username)}</strong><br />
                      Password: <strong>${escapeHtml(password)}</strong>`)}
${emailButton({ href: loginUrl, label: "Sign in" })}
${emailNote(`
                  You'll be asked to choose your own password as soon as you
                  sign in. If you weren't expecting this email, contact PhilLife.`)}`,
  });
};
