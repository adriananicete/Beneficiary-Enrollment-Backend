const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

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
  return {
    contentType: "HTML",
    content: `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Your new sign-in details</title>
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
            Your new sign-in details
          </h2>

          <p style="margin: 0 0 14px 0">Hi ${escapeHtml(firstName)},</p>

          <p style="margin: 0 0 14px 0">
            Your HR has issued you a new temporary password. Any password you
            used before this email no longer works.
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
                  padding: 18px 12px;
                  border: 1px solid #409965;
                  border-radius: 6px;
                  font-size: 16px;
                  line-height: 1.8;
                  color: #1a1760;
                "
              >
                Username: <strong>${escapeHtml(username)}</strong><br />
                Password: <strong>${escapeHtml(password)}</strong>
              </td>
            </tr>
          </table>

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
            You'll be asked to choose your own password as soon as you sign in.
            If you didn't ask for this, contact your HR straight away — someone
            requested it on your behalf.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>
`,
  };
};
