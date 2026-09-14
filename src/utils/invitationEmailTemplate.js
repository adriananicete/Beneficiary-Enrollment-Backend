import { escapeHtml } from "./escapeHtml.js";
import { emailButton, emailLayout, emailNote } from "./emailLayout.js";

// `companyName` comes from the employers table rather than from a form, so this
// is the lowest-risk of the five. Escaped anyway, so that all five templates
// read the same way and nobody has to work out why one differs.
export const invitationEmailTemplate = ({ companyName, enrollmentUrl }) => {
  return emailLayout({
    title: "Individual Insurance Enrollment",
    heading: "Individual Insurance Enrollment",
    body: `
                <p style="margin: 0 0 14px 0">
                  <strong>${escapeHtml(companyName)}</strong> has invited you to
                  complete your insurance enrollment for your group life
                  insurance coverage with PhilLife. Before you begin, please
                  have these ready:
                </p>

                <ul style="margin: 0 0 4px 0; padding-left: 20px">
                  <li style="margin-bottom: 4px">Your Employee ID number</li>
                  <li style="margin-bottom: 4px">
                    Your TIN and SSS/GSIS numbers
                  </li>
                  <li style="margin-bottom: 4px">Your complete home address</li>
                  <li style="margin-bottom: 4px">
                    The details of any beneficiaries you want to name &mdash;
                    full name, relationship, and age
                  </li>
                </ul>
${emailButton({ href: enrollmentUrl, label: "Enroll Now" })}
${emailNote(`
                  <span style="text-decoration: underline; font-style: italic"
                    >This link expires in <strong>7 days</strong></span
                  >
                  and is intended only for this email address. Please don't
                  forward it to anyone else. Once you submit, you'll receive a
                  separate email with your login details so you can view or
                  update your enrollment later.`)}`,
  });
};
