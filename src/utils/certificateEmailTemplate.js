import { escapeHtml } from "./escapeHtml.js";
import { emailCallout, emailLayout, emailNote } from "./emailLayout.js";

// Sent when HR resends the Certificate of Coverage on its own. Deliberately not
// the enrollment confirmation template: that one carries a username and a
// temporary password, and a certificate resent months later must not arrive
// looking like a second set of credentials.
//
// The only one of the five with no button. There is nothing to do with it but
// open the attachment.
export const certificateEmailTemplate = ({ firstName, policyNo }) => {
  return emailLayout({
    title: "Your Certificate of Coverage",
    heading: "Your Certificate of Coverage",
    body: `
                <p style="margin: 0 0 14px 0">Hi ${escapeHtml(firstName)},</p>

                <p style="margin: 0 0 14px 0">
                  Your HR has sent you a copy of your Certificate of Coverage.
                  It is attached to this email as a PDF.
                </p>
${emailCallout(`
                      Policy Number: <strong>${escapeHtml(policyNo)}</strong>`)}
${emailNote(`
                  Nothing about your account has changed, and your password
                  still works. If you did not expect this email, contact your
                  HR.`)}`,
  });
};
