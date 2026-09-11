import { escapeHtml } from "./escapeHtml.js";

// Sent when HR resends the Certificate of Coverage on its own. Deliberately not
// the enrollment confirmation template: that one carries a username and a
// temporary password, and a certificate resent months later must not arrive
// looking like a second set of credentials.
//
// Laid out like credentialsEmailTemplate so the two emails HR can trigger
// read as coming from the same place.
export const certificateEmailTemplate = ({ firstName, policyNo }) => {
  return {
    contentType: "HTML",
    content: `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Your Certificate of Coverage</title>
  </head>
  <body style="margin: 0; padding: 0; background-color: #f1f1f1">
    <table
      width="450"
      cellpadding="0"
      cellspacing="0"
      border="0"
      bgcolor="#ffffff"
      style="width: 450px; border-radius: 6px"
    >
      <!-- logo -->
      <tr>
        <td align="center" style="padding: 28px 26px 0 26px">
          <img
            src="https://res.cloudinary.com/dks2psaem/image/upload/v1786525078/PhilLife_Color_tcjvib.png"
            width="260"
            alt="PhilLife"
            style="
              display: block;
              width: 260px;
              max-width: 100%;
              height: auto;
              border: 0;
              outline: none;
              text-decoration: none;
            "
          />
        </td>
      </tr>

      <!-- content -->
      <tr>
        <td
          style="
            padding: 20px 26px 28px 26px;
            font-family:
              &quot;Segoe UI&quot;, Tahoma, Geneva, Verdana, sans-serif;
            font-size: 15px;
            line-height: 1.6;
            color: #333333;
          "
        >
          <h2
            style="
              margin: 0 0 16px 0;
              color: #1a1760;
              font-size: 20px;
              text-align: center;
            "
          >
            Your Certificate of Coverage
          </h2>

          <p style="margin: 0 0 14px 0">Hi ${escapeHtml(firstName)},</p>

          <p style="margin: 0 0 14px 0">
            Your HR has sent you a copy of your Certificate of Coverage. It is
            attached to this email as a PDF.
          </p>

          <table
            width="100%"
            cellpadding="0"
            cellspacing="0"
            border="0"
            style="width: 100%; margin: 18px 0"
          >
            <tr>
              <td
                align="center"
                style="
                  padding: 14px 12px;
                  border: 1px solid #409965;
                  border-radius: 6px;
                  font-size: 16px;
                  color: #1a1760;
                "
              >
                Policy Number: <strong>${escapeHtml(policyNo)}</strong>
              </td>
            </tr>
          </table>

          <p
            style="margin: 0; font-size: 13px; line-height: 1.6; color: #555555"
          >
            Nothing about your account has changed, and your password still
            works. If you did not expect this email, contact your HR.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>
`,
  };
};
