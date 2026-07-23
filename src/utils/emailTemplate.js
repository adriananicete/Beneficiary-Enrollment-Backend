import config from "../config/env.js";

export const emailTemplate = ({
  referenceNumber,
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
    <title>Employee Account</title>
  </head>
  <body
    style="
      margin: 0;
      padding: 0;
      box-sizing: border-box;
      font-family: &quot;Segoe UI&quot;, Tahoma, Geneva, Verdana, sans-serif;
      background: #f8f9fa;
      color: #333;
    "
  >
    <table
      role="presentation"
      style="
        width: 100%;
        max-width: 600px;
        margin: 20px auto;
        background: #fff;
        border-radius: 12px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        overflow: hidden;
        border-collapse: collapse;
      "
    >
      <!-- Header -->
      <tr>
        <td
          bgcolor="#4caf50"
          style="
            background-color: #4caf50;
            background: linear-gradient(135deg, #4caf50 0%, #45a049 100%);
            text-align: center;
            padding: 20px;
            color: white;
          "
        >
          <h1 style="margin: 0; font-size: 24px; font-weight: 300">
            Your account has been created
          </h1>
          <!-- <p style="margin: 5px 0 0; font-size: 14px; opacity: 0.9">
            Your account has been created
          </p> -->
        </td>
      </tr>

      <!-- Content -->
      <tr>
        <td style="padding: 30px 25px">
          <!-- <p style="margin:0 0 20px; font-size:16px;">Hello Mr/Mrs, <strong>${lastname}</strong></p> -->

          <p style="margin: 0 0 25px; font-size: 16px">
            Reference Enrollment Number:
          </p>

          <!-- Password Highlight -->
          <div
            style="
              text-align: center;
              margin: 25px 0;
              padding: 20px;
              background: #fff3e0;
              border: 1px solid #4caf50;
              border-radius: 10px;
            "
          >
            <h2
              style="
                margin: 0;
                font-size: 16px;
                font-weight: bold;
                color: #2c5530;
                font-family: &quot;Courier New&quot;, monospace;
              "
            >
              ${referenceNumber}
            </h2>
          </div>

          <p style="font-size: 14px; font-style: oblique">
            Your temporary account is:
          </p>

          <p style="font-size: 16px">
            Username: ${username} Password: ${password}
          </p>

          <p style="margin: 20px 0; font-size: 16px">
            Please
            <a
              href="https://localhost:${config.PORT}${loginUrl}"
              target="_blank"
              style="color: #3498db; text-decoration: none"
              >login</a
            >
            and reset your password immediately for security.
          </p>

          <p
            style="
              margin: 25px 0 0;
              font-size: 14px;
              color: #555;
              text-align: center;
              font-style: italic;
            "
          >
            Thank you for trusting! Stay secure.
          </p>
        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td
          style="
            background: #f8f9fa;
            text-align: center;
            padding: 20px;
            border-top: 1px solid #e9ecef;
          "
        >
          <p style="margin: 0; font-size: 12px; color: #6c757d">
            © 2026 Phillife System. All rights reserved.
          </p>

          <p
            style="
              font-size: 9pt;
              color: #c62828;
              margin-top: 10px;
              font-style: italic;
            "
          >
            <strong>Notice:</strong> Please do not reply directly to this email.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>
    `,
  };
};
