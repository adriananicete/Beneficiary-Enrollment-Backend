

export const emailTemplate = ({
  policyNo,
  username,
  firstName,
  lastName,
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
      color: #333;
    "
  >
    <table
      role="presentation"
      style="
        width: 100%;
        max-width: 400px;
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
            background: linear-gradient(90deg, #2c3b7d 0%, #409965 100%);
            text-align: center;
            padding: 20px;
            color: white;
          "
        >
          <h1 style="margin: 0; font-size: 20px; font-weight: 300">
            Your account has been created
          </h1>
        </td>
      </tr>

      <!-- Content -->
      <tr>
        <td style="padding:25px">

          <!-- Password Highlight -->
          <div
            style="
              text-align: left;
              border-radius: 10px;
              background-color: #daf2e6;
              padding: 10px;
            "
          >
            <h2
              style="
                margin: 0;
                font-size: 16px;
                font-weight: bold;
              "
            >
              Policy Number: ${policyNo}
            </h2>
          </div>
          
          <p style="font-size: 16px;">
            Hi ${firstName} this is your temporary account:
          </p>

          <p style="text-align: center; border-radius: 5px; border: 1px solid #4caf50; padding: 20px 0; font-size: 16px">
            Username: ${username} <br/> Password: ${password}
          </p>

          <p style="margin: 20px 0; font-size: 16px">
            Please
            <a
              href="${loginUrl}"
              target="_blank"
              style="color: #3498db; text-decoration: none; font-style: oblique;"
              >login</a
            >
            and reset your password immediately for security.
          </p>

          <p
            style="
              margin: 25px 0 0;
              font-size: 12px;
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
            text-align: center;
            padding: 20px;
            border-top: 1px solid #e9ecef;
          "
        >
          <p style="margin: 0; font-size: 10px; color: #6c757d">
            © 2026 Phillife System. All rights reserved.
          </p>

          <p
            style="
              font-size: 10px;
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
