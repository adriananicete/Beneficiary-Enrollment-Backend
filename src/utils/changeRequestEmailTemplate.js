// HR's review remarks are free text written by one person about another and go
// straight into an HTML document. Escaped rather than trusted — this is the
// only field in any template that crosses a user boundary.
import { escapeHtml } from "./escapeHtml.js";
import { emailButton, emailLayout, emailNote } from "./emailLayout.js";

export const changeRequestEmailTemplate = ({
  firstName,
  approved,
  reviewRemarks,
  loginUrl,
  certificateAttached = false,
}) => {
  const heading = approved ? "Your changes were approved" : "Your changes need another look";

  const lead = approved
    ? `Your HR has approved the update you requested to your enrollment details. The changes are now on your record — you can sign in to see them.`
    : `Your HR has reviewed the update you requested to your enrollment details and has not applied it. You can sign in and submit a new request once the note below has been addressed.`;

  // Said only when the certificate is really attached. It is built separately
  // and can fail, and the email goes out regardless — a line promising an
  // attachment that is not there would send the employee looking for it.
  const certificateLine =
    approved && certificateAttached
      ? `
                <p style="margin: 0 0 14px 0">
                  Your updated Certificate of Coverage is attached to this
                  email.
                </p>`
      : "";

  const accent = approved ? "#409965" : "#b3541e";

  // The one block the shared layout has no helper for, because only this email
  // has it and the accent changes with the decision.
  const remarksBlock = reviewRemarks
    ? `
                <table
                  width="100%"
                  cellpadding="0"
                  cellspacing="0"
                  border="0"
                  style="width: 100%; margin: 18px 0"
                >
                  <tr>
                    <td
                      style="
                        padding: 14px 16px;
                        background-color: #f7f7f7;
                        border-left: 4px solid ${accent};
                        font-size: 14px;
                        line-height: 1.6;
                        color: #333333;
                      "
                    >
                      <strong
                        style="
                          display: block;
                          margin-bottom: 6px;
                          color: #1a1760;
                        "
                      >
                        Note from your HR
                      </strong>
                      ${escapeHtml(reviewRemarks)}
                    </td>
                  </tr>
                </table>`
    : "";

  return emailLayout({
    title: heading,
    heading,
    body: `
                <p style="margin: 0 0 14px 0">Hi ${escapeHtml(firstName)},</p>

                <p style="margin: 0 0 14px 0">${lead}</p>
${certificateLine}
${remarksBlock}
${emailButton({ href: loginUrl, label: "Sign in" })}
${emailNote(`
                  You are receiving this because you asked your HR to update
                  your enrollment details. If that wasn't you, please contact
                  your HR.`)}`,
  });
};
