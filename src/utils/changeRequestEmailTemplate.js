// HR's review remarks are free text written by one person about another and go
// straight into an HTML document. Escaped rather than trusted.
const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const changeRequestEmailTemplate = ({
  firstName,
  approved,
  reviewRemarks,
  loginUrl,
}) => {
  const heading = approved ? "Your changes were approved" : "Your changes need another look";

  const lead = approved
    ? `Your HR has approved the update you requested to your enrollment details. The changes are now on your record — you can sign in to see them.`
    : `Your HR has reviewed the update you requested to your enrollment details and has not applied it. You can sign in and submit a new request once the note below has been addressed.`;

  const accent = approved ? "#409965" : "#b3541e";

  const remarksBlock = reviewRemarks
    ? `
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; margin: 18px 0">
            <tr>
              <td style="
                    padding: 14px 16px;
                    background-color: #f7f7f7;
                    border-left: 4px solid ${accent};
                    font-size: 14px;
                    line-height: 1.6;
                    color: #333333;
                  ">
                <strong style="display: block; margin-bottom: 6px; color: #1a1760">
                  Note from your HR
                </strong>
                ${escapeHtml(reviewRemarks)}
              </td>
            </tr>
          </table>`
    : "";

  return {
    contentType: "HTML",
    content: `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${heading}</title>
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
            ${heading}
          </h2>

          <p style="margin: 0 0 14px 0">
            Hi ${escapeHtml(firstName)},
          </p>

          <p style="margin: 0 0 14px 0">${lead}</p>
          ${remarksBlock}

          <table
            width="100%"
            cellpadding="0"
            cellspacing="0"
            border="0"
            style="width: 100%; margin: 22px 0"
          >
            <tr>
              <td
                width="100%"
                align="center"
                bgcolor="#2c3b7d"
                style="
                  width: 100%;
                  padding: 12px 0;
                  border-radius: 5px;
                  background: linear-gradient(90deg, #2c3b7d 0%, #409965 100%);
                "
              >
                <a
                  href="${loginUrl}"
                  target="_blank"
                  rel="noopener noreferrer"
                  style="
                    display: block;
                    color: #ffffff;
                    font-family:
                      &quot;Segoe UI&quot;, Tahoma, Geneva, Verdana, sans-serif;
                    font-size: 15px;
                    font-weight: bold;
                    line-height: 20px;
                    text-decoration: none;
                    text-align: center;
                  "
                >
                  Sign in
                </a>
              </td>
            </tr>
          </table>

          <p
            style="margin: 0; font-size: 13px; line-height: 1.6; color: #555555"
          >
            You are receiving this because you asked your HR to update your
            enrollment details. If that wasn't you, please contact your HR.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>
`,
  };
};
